# Découpe les DCI de la nomenclature en molécules actives (sans sels ni hydrates).
# Usage : python -I dci_components.py dcis.json sortie.sql
#   dcis.json : liste JSON des DCI distinctes de public.drugs
# Le résultat est une proposition automatique : la pharmacienne valide chaque
# rattachement avant qu'il serve à une alerte.
import sys, json, re, unicodedata

SALTS = '''chlorhydrate dichlorhydrate hydrochloride bromhydrate sulfate sulphate bisulfate hemisulfate
sodique sodium disodique disodium potassique potassium calcique calcium magnesien magnesium
maleate hydrogenomaleate fumarate hemifumarate tartrate bitartrate ditartrate ditratrate succinate citrate
acetate diacetate mesilate mesylate dimesilate besilate besylate tosilate tosylate phosphate
diphosphate dihydrogenophosphate nitrate lactate gluconate stearate palmitate propionate dipropionate
valerate butyrate furoate acetonide pivalate benzoate oxalate malate hyclate diethylamine
bromure iodure methylbromure trometamol arginine lysine meglumine medoxomil cilexetil
anhydre base micronise micronisee lourd leger hemi de d du l dl des la le'''.split()
SALTS_RE = re.compile(r'\b(' + '|'.join(sorted(set(SALTS), key=len, reverse=True)) + r'|\w*hydratee?s?)\b')
# Sels minéraux : seul l'ion compte pour les interactions (calcium, potassium, fer…)
CATIONS = {'calcium': 'calcium', 'calcique': 'calcium', 'magnesium': 'magnesium', 'magnesien': 'magnesium',
           'potassium': 'potassium', 'potassique': 'potassium', 'sodium': 'sodium', 'sodique': 'sodium',
           'ferreux': 'fer', 'ferrique': 'fer', 'fer': 'fer', 'zinc': 'zinc', 'aluminium': 'aluminium',
           'lithium': 'lithium'}
ANIONS = set('''carbonate bicarbonate hydrogenocarbonate chlorure oxyde hydroxyde sulfate gluconate lactate
citrate phosphate glycerophosphate fumarate succinate ascorbate pidolate aspartate acetate'''.split())
NOISE = {'lp', 'active', 'actif', 'dci'}
EXPR_EN = re.compile(r'(?:exprime|experime|exprimee)e?s?\s+en\s+(.+)$')
SOUS_FORME = re.compile(r'\b(?:sous forme|s/f)\b.*$')


def fold(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', s).strip()


def tidy(p):
    p = re.sub(r"[^a-z0-9 \-]", ' ', p)
    return re.sub(r'\s+', ' ', p).strip(' -')


def core_of(p):
    words = tidy(p).split()
    cations = [CATIONS[w] for w in words if w in CATIONS]
    rest = [w for w in tidy(SALTS_RE.sub(' ', ' '.join(words))).split() if w not in ANIONS and w not in CATIONS and w not in NOISE]
    if rest:
        return ' '.join(rest)
    return cations[0] if cations else None


def clean_part(p):
    p = fold(p).replace("'", ' ')
    p = re.sub(r'\*+', '', p)
    p = re.sub(r'\d+([.,]\d+)?\s*%.*$', '', p)            # pourcentages d'insulines, titrages
    p = re.sub(r'\((?:dci|ou [^)]*)\)', ' ', p)             # « (DCI) », « (ou 1 alpha-…) »
    cands = []
    m = EXPR_EN.search(p)
    if m:
        cands.append(m.group(1))                            # « X exprimé en Y » : Y
    head = SOUS_FORME.sub('', EXPR_EN.sub('', p))
    cands.append(re.sub(r'\(.*$', '', head))                # avant la parenthèse
    cands.append(head)
    for c in cands:
        c = core_of(c)
        if c and len(c) >= 3:
            return c
    return None


def components(dci):
    parts = re.split(r'\s*(?:/|\+|;|,(?![^()]*\))|\bet\b)\s*', dci)
    out = []
    for raw in parts:
        c = clean_part(raw)
        if c and c not in out:
            out.append(c)
    return out


if __name__ == '__main__':
    dcis = json.load(open(sys.argv[1], encoding='utf-8'))
    rows = []
    for d in dcis:
        for i, c in enumerate(components(d)):
            rows.append((d, c, i + 1))
    q = lambda s: "'" + s.replace("'", "''") + "'"
    with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
        f.write('insert into public.dci_components (dci, component, position) values\n')
        f.write(',\n'.join(f'({q(d)}, {q(c)}, {i})' for d, c, i in rows))
        f.write('\non conflict do nothing;\n')
    print(len(dcis), 'DCI,', len(rows), 'rattachements')
