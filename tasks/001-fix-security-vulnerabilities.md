# UŽDUOTIS #001: Ištaisyti NPM saugumo spragas

## 🔴 PRIORITETAS: KRITINIS
**Terminas**: Nedelsiant (prieš bet kokį deployment)
**Laikas**: ~2-4 valandos
**Blokuoja**: Production deployment

## 📋 Problema

Projektas turi 8 npm pažeidžiamumus:
- 3 aukšto lygio (HIGH)
- 2 vidutinio lygio (MODERATE)
- 3 žemo lygio (LOW)

Pagrindinės problemos:
- `lodash.template` - Command injection pažeidžiamumas
- `tmp` package - Arbitrary file access
- `esbuild` - Development server exposure

## 🎯 Kodėl tai kritiškai svarbu?

1. **Saugumo rizika**: HIGH severity pažeidžiamumai gali leisti:
   - Vykdyti kodą serveryje (command injection)
   - Pasiekti bet kokius failus sistemoje
   - Atskleisti jautrią informaciją per dev serverį

2. **Compliance**: Paysera turi griežtus saugumo reikalavimus finansinėms sistemoms

3. **Reputacijos rizika**: Saugumo incidentas gali paveikti visą organizaciją

## 🔧 Kaip taisyti

### Žingsnis 1: Patikrinti pažeidžiamumus
```bash
cd /opt/dev/rocket-chat-universal-translator

# Patikrinti visus pažeidžiamumus
npm audit

# Detalus report
npm audit --json > security-audit.json
```

### Žingsnis 2: Automatinis taisymas
```bash
# Bandyti automatinį taisymą
npm audit fix

# Jei reikia, forsuoti major version updates
npm audit fix --force
```

### Žingsnis 3: Manualinis taisymas (jei automatinis neveikia)

#### A. Lodash pažeidžiamumo taisymas:
```bash
# Atnaujinti lodash į saugią versiją
npm uninstall lodash.template
npm install lodash@latest

# Arba pakeisti į saugesnę alternatyvą
npm install lodash-es@latest
```

#### B. Tmp package taisymas:
```bash
# Atnaujinti arba pakeisti
npm uninstall tmp
npm install tmp@latest

# Alternatyva: naudoti node:fs/promises su mkdtemp
```

#### C. Esbuild taisymas:
```bash
# Atnaujinti į naujausią versiją
npm update esbuild

# Jei naudojama tik development, perkelti į devDependencies
npm uninstall esbuild
npm install --save-dev esbuild@latest
```

### Žingsnis 4: Patikrinti workspace'us
```bash
# API workspace
cd api
npm audit
npm audit fix

# Plugin workspace
cd ../plugin
npm audit
npm audit fix

# Shared workspace
cd ../shared
npm audit
npm audit fix
```

### Žingsnis 5: Verifikacija
```bash
cd /opt/dev/rocket-chat-universal-translator

# Patikrinti ar liko pažeidžiamumų
npm audit

# Turėtų rodyti: "found 0 vulnerabilities"

# Patikrinti ar viskas kompiliuojasi
npm run build

# Paleisti testus
npm test
```

### Žingsnis 6: Dependency lock atnaujinimas
```bash
# Atnaujinti package-lock.json
rm -rf node_modules package-lock.json
npm install

# Commit changes
git add package.json package-lock.json
git commit -m "fix: security vulnerabilities patched"
```

## ✅ Sėkmės kriterijai

- [ ] `npm audit` rodo 0 kritinių/aukštų pažeidžiamumų
- [ ] Visi workspace'ai neturi saugumo spragų
- [ ] Projektas kompiliuojasi sėkmingai
- [ ] Testai praeina (kai bus paleisti)
- [ ] package-lock.json atnaujintas

## ⚠️ Galimos problemos

1. **Breaking changes**: Kai kurie updates gali sugadinti compatibility
   - Sprendimas: Testuoti po kiekvieno update

2. **Peer dependency konfliktai**: Rocket.Chat Apps engine gali reikalauti senesnių versijų
   - Sprendimas: Naudoti `npm ls` patikrinti dependency tree

3. **Build failures**: Po update gali reikėti keisti kodą
   - Sprendimas: Žiūrėti migration guides atnaujintų paketų

## 📚 Papildomi resursai

- [NPM Audit dokumentacija](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)
- [Snyk vulnerability database](https://snyk.io/vuln)

## 📝 Pastabos

Po šios užduoties atlikimo būtina:
1. Paleisti pilną regression testavimą
2. Patikrinti ar visi API endpoints veikia
3. Patikrinti ar plugin sėkmingai package'inasi
4. Dokumentuoti visus atliktus pakeitimus CHANGELOG.md