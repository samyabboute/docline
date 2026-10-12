# Prépare l'import du Thésaurus ANSM (sortie de thesaurus_extract.py) en SQL.
# Usage : python -I thesaurus_build_sql.py thesaurus.json dcis.json sortie.sql
# Tout arrive en attente de validation : interactions en brouillon, rattachements
# « proposés ». La source est créée avec un droit de réutilisation « en attente ».
# À n'appliquer qu'après l'accord écrit de l'ANSM.
import sys, re, json, difflib
from thesaurus_extract import fold
from dci_components import components


def strip_paren(k):
    return re.sub(r'\s*\(.*?\)\s*', ' ', k).strip()


def nice(label):
    label = label.strip()
    if label.isupper():
        label = label.lower()
    return label[:1].upper() + label[1:]


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main(src_json, dcis_json, dest):
    j = json.load(open(src_json, encoding='utf-8'))
    ents = {}                                     # clé -> {label, kind}
    for s in j['substances']:
        ents.setdefault(s['key'], {'label': nice(s['label']), 'kind': 'substance'})
    class_key = {}
    for c in j['classes']:
        k = c['key'] if c['key'] not in ents or ents[c['key']]['kind'] == 'class' else c['key'] + ' (classe)'
        ents[k] = {'label': nice(c['label']), 'kind': 'class'}
        class_key[c['key']] = k

    def resolve(name, create=True):
        k = fold(name)
        for cand in (k, strip_paren(k)):
            if cand in class_key: return class_key[cand]
            if cand in ents: return cand
        if k.startswith('autres '):                # « AUTRES ANTICOAGULANTS ORAUX » -> la classe
            r = resolve(name[7:], create=False)
            if r: return r
        if not create: return None
        ents[k] = {'label': nice(name), 'kind': 'class'}   # rubrique sans index (ex. voie orale)
        return k

    members = set()
    for c in j['classes']:
        ck = class_key[c['key']]
        for m in c['members']:
            mk = resolve(m)
            if mk != ck:
                members.add((ck, mk))

    inter = {}
    for r in j['rows']:
        a, b = resolve(r['a']), resolve(r['b'])
        if a == b: continue
        key = tuple(sorted((a, b))) + (r['level'],)
        if key not in inter:
            inter[key] = r

    # Rattachements proposés : molécules de la nomenclature -> substances du référentiel
    comps = sorted({c for d in json.load(open(dcis_json, encoding='utf-8')) for c in components(d)})
    subs = {k: v for k, v in ents.items() if v['kind'] == 'substance'}
    by_short = {}
    for k in subs:
        by_short.setdefault(strip_paren(k), k)
    cls_short = {strip_paren(k): k for k, v in ents.items() if v['kind'] == 'class'}
    maps = []
    for c in comps:
        if c in subs: maps.append((c, c, 1.0)); continue
        if c in by_short: maps.append((c, by_short[c], 1.0)); continue
        if c in cls_short: maps.append((c, cls_short[c], 0.9)); continue
        pref = [k for k in subs if k.startswith(c + ' ') or c.startswith(k + ' ')]
        if len(pref) == 1: maps.append((c, pref[0], 0.9)); continue
        best = difflib.get_close_matches(c, list(by_short), n=1, cutoff=0.88)
        if best:
            maps.append((c, by_short[best[0]], round(difflib.SequenceMatcher(None, c, best[0]).ratio(), 2)))

    src = j['source']
    with open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write('-- Import du Thésaurus ANSM (%s) : tout en attente de validation\n' % src['version'])
        f.write('do $$ begin if exists (select 1 from interaction_sources where label = %s and version_label = %s) then '
                "raise exception 'Source déjà importée'; end if; end $$;\n" % (q(src['label']), q(src['version'])))
        f.write('create temp table _src on commit drop as with s as (insert into interaction_sources (label, version_label, published_on, url) '
                'values (%s, %s, %s, %s) returning id) select id from s;\n' % (q(src['label']), q(src['version']), q(src['published_on']), q(src['url'])))
        f.write('insert into interaction_substances (key, label, kind, source_id) values\n')
        f.write(',\n'.join('(%s, %s, %s, (select id from _src))' % (q(k), q(v['label']), q(v['kind'])) for k, v in sorted(ents.items())))
        f.write('\non conflict (key) do nothing;\n')
        f.write('insert into interaction_class_members (class_id, substance_id)\nselect c.id, s.id from (values\n')
        f.write(',\n'.join('(%s, %s)' % (q(a), q(b)) for a, b in sorted(members)))
        f.write('\n) v(ck, sk) join interaction_substances c on c.key = v.ck join interaction_substances s on s.key = v.sk on conflict do nothing;\n')
        f.write('insert into drug_interactions (a_id, b_id, level, level_label, mechanism, conduct, source_id, status)\n'
                'select least(a.id, b.id), greatest(a.id, b.id), v.level, v.label, v.mech, v.cond, (select id from _src), \'draft\' from (values\n')
        f.write(',\n'.join('(%s, %s, %s, %s, %s, %s)' % (q(k[0]), q(k[1]), q(k[2]), q(r['level_label']), q(r['mechanism'] or None), q(r['conduct'] or None))
                           for k, r in sorted(inter.items())))
        f.write('\n) v(ak, bk, level, label, mech, cond) join interaction_substances a on a.key = v.ak join interaction_substances b on b.key = v.bk\n'
                'on conflict (a_id, b_id, level, source_id) do nothing;\n')
        f.write('insert into component_substance_map (component, substance_id, origin, score, status)\nselect v.c, s.id, \'auto\', v.score, \'proposed\' from (values\n')
        f.write(',\n'.join('(%s, %s, %s)' % (q(c), q(k), s) for c, k, s in maps))
        f.write('\n) v(c, k, score) join interaction_substances s on s.key = v.k on conflict (component, substance_id) do nothing;\n')
    exact = sum(1 for m in maps if m[2] == 1.0)
    print(len(ents), 'substances et classes,', len(members), 'appartenances,', len(inter), 'interactions,',
          len(maps), 'rattachements proposés (dont', exact, 'exacts) sur', len(comps), 'molécules')


if __name__ == '__main__':
    main(*sys.argv[1:4])
