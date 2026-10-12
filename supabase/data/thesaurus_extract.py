# Extraction du Thésaurus des interactions médicamenteuses de l'ANSM (version PDF).
# Usage : python -I thesaurus_extract.py thesaurus.pdf index_substances.pdf index_classes.pdf sortie.json
# Produit un fichier de travail (substances, classes et leurs membres, interactions) à
# faire valider par la pharmacienne. Rien n'est chargé en base par ce script.
# Le contenu est repris sans modification de sens ; la source et la version sont conservées.
import sys, re, json, unicodedata
import fitz  # PyMuPDF


def fold(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = s.replace('’', "'")
    return re.sub(r'\s+', ' ', s).strip()


def join_lines(lines):
    out = ''
    for l in lines:
        l = l.strip()
        if not l:
            continue
        if out.endswith('-') and len(out) > 1 and out[-2].isalpha() and l[:1].islower():
            out += l                                   # mot coupé en fin de ligne
        else:
            out += (' ' if out else '') + l
    return re.sub(r'\s+', ' ', out.replace('’', "'")).strip()


def spans(page):
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text']
                if t.strip():
                    yield {'x': s['bbox'][0], 'y': s['bbox'][1], 'size': round(s['size'], 1),
                           'font': s['font'], 'bold': s['font'].endswith('F1'), 'text': t}


# ── Index des classes : « classe » puis « (membre, membre, …) » ──
def split_members(txt):
    txt = txt.strip()
    if txt.startswith('('): txt = txt[1:]
    if txt.endswith(')'): txt = txt[:-1]
    out, depth, cur = [], 0, ''
    for ch in txt:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur.strip()); cur = ''
        else:
            cur += ch
    if cur.strip(): out.append(cur.strip())
    return [m for m in out if m]


def parse_classes(path):
    doc = fitz.open(path)
    classes, cur = [], None
    for page in doc:
        for s in spans(page):
            if s['y'] > 795: continue                  # pied de page « Page x sur y »
            if s['size'] >= 12 and s['x'] < 35:
                cur = {'label': s['text'].strip(), 'members_raw': []}
                classes.append(cur)
            elif cur and s['size'] < 9 and s['x'] > 40:
                cur['members_raw'].append(s['text'])
    for c in classes:
        c['members'] = split_members(join_lines(c.pop('members_raw')))
        c['key'] = fold(c['label'])
    return [c for c in classes if c['members']]


# ── Index des substances : « substance » puis « Voir : classes » ──
def parse_substances(path):
    doc = fitz.open(path)
    subs, cur = [], None
    for page in doc:
        for s in spans(page):
            if s['y'] > 795 or s['y'] < 25: continue
            if s['size'] >= 7.8 and s['x'] < 35 and s['bold']:
                cur = {'label': s['text'].strip(), 'note_raw': []}
                subs.append(cur)
            elif cur and s['x'] > 38:
                cur['note_raw'].append(s['text'])
    for s in subs:
        note = join_lines(s.pop('note_raw'))
        s['key'] = fold(s['label'])
        s['own'] = 'en propre' in note.lower()
        m = re.search(r'(?:Voir|voir aussi)\s*:\s*(.+)$', note)
        s['classes'] = [x.strip() for x in m.group(1).split(' - ')] if m else []
    return subs


# ── Thésaurus : rubriques, partenaires, risque (gauche), niveau et conduite (droite) ──
LEVEL_WORDS = [('contre_indication', ('CONTRE-INDICATION', 'CI ', 'CI-', 'CI')),
               ('association_deconseillee', ('DECONSEILLEE', 'ASDEC')),
               ('precaution_emploi', ("PRECAUTION D'EMPLOI", 'PE')),
               ('a_prendre_en_compte', ('A PRENDRE EN COMPTE', 'APEC'))]


def levels_of(label):
    u = fold(label).upper()
    tokens = set(re.split(r'[\s\-/]+', u))
    found = []
    for lvl, words in LEVEL_WORDS:
        for w in words:
            w2 = w.strip(' -')
            if (' ' in w2 and w2 in u) or (w2 in tokens) or (len(w2) > 4 and w2 in u):
                found.append(lvl); break
    return found


def parse_thesaurus(path):
    doc = fitz.open(path)
    rows, main, see_also = [], None, {}
    last_row = None
    for pno, page in enumerate(doc):
        items = [s for s in spans(page) if 40 < s['y'] < 810]
        items.sort(key=lambda s: (round(s['y']), s['x']))
        plus_y = [s['y'] for s in items if s['text'].strip() == '+' and s['x'] < 38]
        page_rows = []
        for s in items:
            t = s['text']
            if s['size'] >= 9.5 and s['x'] < 35 and s['bold']:
                main = {'label': t.strip(), 'page': pno + 1}
                see_also[main['label']] = []
                last_row = None
                continue
            if s['text'].strip() == '+' and s['x'] < 38:
                continue
            if s['size'] >= 7.8 and 36 <= s['x'] < 60 and not s['bold'] and 'F3' in s['font']:
                starts = any(abs(s['y'] - y) < 3 for y in plus_y)
                if starts or last_row is None:
                    last_row = {'main': main['label'] if main else None, 'partner': [t], 'y': s['y'], 'page': pno + 1,
                                'left': [], 'right': []}
                    rows.append(last_row); page_rows.append(last_row)
                else:
                    last_row['partner'].append(t)       # nom de partenaire sur deux lignes
                continue
            if s['size'] < 7.8 and s['x'] < 60 and main and last_row is None:
                see_also[main['label']].append(t)        # « Voir aussi : … »
                continue
            target = last_row
            if target is None:
                continue
            if 85 <= s['x'] < 300:
                target['left'].append(t)
            elif s['x'] >= 300:
                target['right'].append((s['bold'], t))
    out = []
    for r in rows:
        bold_head, rest, in_head = [], [], True
        for b, t in r['right']:
            if in_head and b:
                bold_head.append(t)
            else:
                in_head = False
                rest.append(t)
        label = join_lines(bold_head)
        lv = levels_of(label)
        out.append({'a': r['main'], 'b': join_lines(r['partner']), 'level_label': label,
                    'level': lv[0] if lv else None, 'levels': lv,
                    'mechanism': join_lines(r['left']), 'conduct': join_lines(rest), 'page': r['page']})
    sa = {k: [x.strip() for x in re.sub(r'^\s*Voir aussi\s*:\s*', '', join_lines(v)).split(' - ') if x.strip()]
          for k, v in see_also.items() if v}
    return out, sa


if __name__ == '__main__':
    th, ix_s, ix_c, dest = sys.argv[1:5]
    classes = parse_classes(ix_c)
    subs = parse_substances(ix_s)
    rows, see_also = parse_thesaurus(th)
    json.dump({'source': {'label': 'ANSM, Thésaurus des interactions médicamenteuses', 'version': 'septembre 2023',
                          'published_on': '2023-09-15',
                          'url': 'https://ansm.sante.fr/documents/reference/thesaurus-des-interactions-medicamenteuses-1'},
               'classes': classes, 'substances': subs, 'see_also': see_also, 'rows': rows},
              open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(classes), 'classes,', len(subs), 'substances,', len(rows), 'lignes du thésaurus')
