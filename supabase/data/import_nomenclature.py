# Import de la nomenclature nationale (miph.gov.dz) vers public.drugs.
# Usage : python -I import_nomenclature.py fichier.xlsx dossier_sortie
# Produit des lots SQL a appliquer avec : npx supabase db query --linked -f lot.sql
# En-tetes attendus : lignes 16, 12 et 11 des onglets en vigueur, non renouveles, retraits.
import sys, os, re, unicodedata, datetime, openpyxl
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
def norm(v):
    if v is None: return None
    if isinstance(v, (datetime.datetime, datetime.date)): return v
    s = re.sub(r'\s+', ' ', str(v)).strip()
    return s or None
def key(h): return re.sub(r'\s+', ' ', unicodedata.normalize('NFKD', str(h)).encode('ascii','ignore').decode()).strip().upper() if h else None
def fold(s): return re.sub(r'\s+',' ',unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()).strip()
def dt(v):
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    if isinstance(v, datetime.date): return v.isoformat()
    if isinstance(v, str):
        m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', v)
        if m:
            try: return datetime.date(int(m[3]), int(m[2]), int(m[1])).isoformat()
            except ValueError: return None
    return None
def lst(v):
    v = (v or '').upper().replace(' ', '')
    return {'LISTEI':'I','LISTEII':'II','STUPEFIANT':'STUPEFIANT','STUPEFIANTS':'STUPEFIANT'}.get(v)
rows = {}; counts = {'active':0,'not_renewed':0,'withdrawn':0}; skipped = 0; dups = 0
for ws, hrow, status in zip(wb.worksheets, [15,11,10], ['active','not_renewed','withdrawn']):
    data = list(ws.iter_rows(values_only=True))
    H = {key(h): i for i, h in enumerate(data[hrow]) if h}
    g = lambda r, name: norm(r[H[name]]) if name in H and H[name] < len(r) else None
    lab = next(k for k in H if k.startswith('LABORATOIRES')); ctry = next(k for k in H if k.startswith('PAYS'))
    for r in data[hrow+1:]:
        reg, dci, brand = g(r,'NÂ°ENREGISTREMENT') or g(r,'NENREGISTREMENT'), g(r,'DENOMINATION COMMUNE INTERNATIONALE'), g(r,'NOM DE MARQUE')
        if not (reg and dci and brand): skipped += 1; continue
        pk = g(r,'CONDITIONNEMENT')
        k = (reg, brand, pk or '', status)
        if k in rows: dups += 1; continue
        t = g(r,'TYPE'); st = g(r,'STATUT'); form = g(r,'FORME'); dos = g(r,'DOSAGE')
        rows[k] = dict(reg_number=reg, dci_code=g(r,'CODE'), dci=dci, brand=brand, form=form, dosage=dos, packaging=pk,
            list=lst(g(r,'LISTE')), hospital=(g(r,'P1') or '').upper()=='HOP', pharmacy=(g(r,'P2') or '').upper()=='OFF',
            observation=g(r,'OBS'), lab=g(r,lab), lab_country=g(r,ctry),
            registered_at=dt(g(r,"DATE D'ENREGISTREMENT INITIAL")), renewed_at=dt(g(r,"DATE D'ENREGISTREMENT FINAL")),
            product_type=t if t in ('GE','RE','BIO') else None, origin=st if st in ('F','I') else None, status=status,
            withdrawn_at=dt(g(r,'DATE DE RETRAIT')), withdrawal_reason=g(r,'MOTIF DE RETRAIT'),
            search_text=fold(' '.join(x for x in (brand, dci, dos, form) if x)), version_id=1)
        counts[status] += 1
cols = list(next(iter(rows.values())).keys())
def lit(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
vals = list(rows.values()); n = 0
for b in range(0, len(vals), 1500):
    n += 1
    with open(os.path.join(out, f'drugs_{n:02d}.sql'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(f'insert into public.drugs ({", ".join(cols)}) values\n')
        f.write(',\n'.join('(' + ', '.join(lit(v[c]) for c in cols) + ')' for v in vals[b:b+1500]))
        f.write(';\n')
with open(os.path.join(out, 'drugs_00_version.sql'), 'w', encoding='utf-8', newline='\n') as f:
    f.write("insert into public.drug_catalog_versions (id, label, source_url, active_count, not_renewed_count, withdrawn_count) values "
            f"(1, 'Nomenclature nationale, août 2026', 'https://www.miph.gov.dz/fr/wp-content/uploads/2026/09/clean_NOMENCLATURE.VERSION.AOUT_.2026-.xlsx', {counts['active']}, {counts['not_renewed']}, {counts['withdrawn']});\n"
            "select setval(pg_get_serial_sequence('public.drug_catalog_versions', 'id'), 1);\n")
print(counts, 'skipped', skipped, 'dups', dups, 'files', n)
