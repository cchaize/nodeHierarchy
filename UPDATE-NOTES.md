# Xtrem Nodes Hierarchy - Mises à jour v0.0.2

## 🔧 Améliorations du Parser

### 1. Détection Plus Complète des Nodes

✅ **Le parser maintenant:**

- Scanne les répertoires: `nodes/`, `node-extensions/`, `src/nodes/`, `src/node-extensions/`
- A un fallback: si aucun node trouvé dans les répertoires cibles, scanne tout le workspace
- Loggue la découverte pour faciliter le débogage
- Compte et reporte le total de nodes trouvés

### 2. Capture de Toutes les Propriétés

✅ **Maintenant capture:**

- **Propriétés décorées** avec `@decorators.property()`, `@property()`, etc.
- **Propriétés non décorées** (champs simples TypeScript)
- **Propriétés avec modificateurs** (`public`, `private`, `protected`)
- **Propriétés avec types complexes** (generics `List<T>`, unions `A | B`, etc.)

### 3. Meilleure Détection de Propriétés

✅ **Patterns supportés:**

```typescript
// Propriétés décorées
@ui.decorators.property()
propertyName: string;

// Propriétés non décorées
document: BaseDocument;
lineItems: Item[];

// Propriétés avec modificateurs
private internalField: string;
protected baseValue: number;

// Propriétés avec types complexes
items: List<Item>;
values: string | null;
```

### 4. Logging Amélioré

✅ **Pour déboguer, vérifiez la console (Ctrl+Shift+U → Debug Console):**

- "Pattern "..." found X files"
- "Found N TypeScript files in nodes directories"
- "Found node: ClassName with X properties"
- "Parsing complete. Total nodes found: N"

## 🐛 Corrections

- ✅ Syntaxe TypeScript corrigée
- ✅ Gestion d'erreurs améliorée
- ✅ Évite les doublons dans la liste de fichiers

## 📊 Résultats Attendus

Avant (un seul property 'document'):

```
BaseOutboundDocumentLine:
  ├── document
```

Après (toutes les propriétés):

```
BaseOutboundDocumentLine:
  ├── document
  ├── warehouse
  ├── serialNumber
  ├── quantity
  ├── itemRef
  ├── unit
  ...
```

## 🔍 Comment Tester

1. **Ouvrez le Debug Console** (Ctrl+Shift+U → Select "Debug Console")
2. **Ouvrez la Command Palette** (Ctrl+Shift+P)
3. **Recherchez** "Xtrem: Refresh"
4. **Observez les logs** pour voir les nodes trouvés
5. **Ouvrez la vue** "Xtrem Nodes Hierarchy"
6. **Cherchez un node** → Vous devrlez voir TOUTES ses propriétés!

## ✨ Améliorations Futures

- [ ] Support de l'héritage de propriétés (propriétés des classes parent)
- [ ] Caching plus intelligent
- [ ] Support des mixins TypeScript
- [ ] Parsing AST (plus robuste)

---

**Version**: 0.0.2  
**Date**: 11 Février 2026
