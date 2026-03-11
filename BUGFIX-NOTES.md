# Xtrem Nodes Hierarchy - Corrections v0.0.4

## 🐛 Problèmes Résolus

### 1. Paramètres de Décorateurs Affichés comme Propriétés ⭐

**Issue**: `isNullable`, `defaultValue`, `dependsOn` apparaissaient dans la liste des propriétés.

**Cause**: Le parser analysait le contenu des décorateurs multi-lignes et détectait les paramètres d'objets comme des propriétés.

**Solution**:

- ✅ Ajout d'un mécanisme de tracking des décorateurs (comptage des parenthèses)
- ✅ Skip automatique des lignes à l'intérieur des décorateurs
- ✅ Seules les vraies déclarations de propriétés TypeScript sont capturées

### 2. Propriétés Manquantes ⭐

**Issue**: Seules quelques propriétés étaient capturées, pas toutes.

**Cause**: La regex ne gérait pas les patterns TypeScript avancés utilisés par Xtrem:

- `override readonly propertyName: Type`
- Types complexes: `Reference<T>`, `Promise<decimal>`
- Décorateurs avec génériques: `@decorators.propertyOverride<Node, 'prop'>`

**Solution**:

- ✅ Regex améliorée: `/^(?:override\s+)?(?:readonly\s+)?(\w+)\s*[!?]?:\s*(\S.+)$/`
- ✅ Support de `override` et `readonly` combinés
- ✅ Meilleure gestion des types complexes

### 3. Propriétés Héritées Non Affichées ⭐

**Issue**: Les propriétés définies dans les classes parentes n'étaient pas visibles.

**Solution**:

- ✅ Nouvelle méthode `getAllProperties(nodeName)` remonte la chaîne d'héritage
- ✅ Collecte récursive depuis le parent le plus haut jusqu'à la classe actuelle
- ✅ Les propriétés enfant remplacent correctement les propriétés parent (override)

## ✅ Patterns Complexes Maintenant Supportés

### Exemple Réel du Code Xtrem

```typescript
// Decorator multi-ligne avec fonction async
@decorators.referencePropertyOverride<BaseOutboundDocumentLine, 'unit'>({
    dependsOn: ['item'],
    async defaultValue() {
        const itemCustomer = await this.itemCustomer;
        if (itemCustomer && (await itemCustomer.isActive)) {
            return itemCustomer.salesUnit;
        }
        const item = await this.item;
        return (await item?.salesUnit) ?? item.stockUnit;
    },
})
override readonly unit: Reference<xtremMasterData.nodes.UnitOfMeasure>;
```

**Avant v0.0.4**: Le parser capturait à tort:

- ❌ `dependsOn` comme propriété
- ❌ `defaultValue` comme propriété
- ❌ `itemCustomer` (à l'intérieur de la fonction) comme propriété
- ❌ `item` (à l'intérieur de la fonction) comme propriété
- ✓ `unit` (OK mais seul)

**Après v0.0.4**: Le parser capture correctement:

- ✅ `unit` uniquement
- ✅ Toutes les autres vraies propriétés de la classe
- ✅ Toutes les propriétés héritées des parents

## 📊 Résultats Attendus pour BaseOutboundDocumentLine

### Propriétés Déclarées dans BaseOutboundDocumentLine

```typescript
✅ document: Reference<BaseOutboundDocument>
   (referencePropertyOverride)

✅ itemCustomer: Reference<ItemCustomer | null>
   (referenceProperty)

✅ unit: Reference<UnitOfMeasure>
   (referencePropertyOverride)

✅ unitToStockUnitConversionFactor: Promise<decimal>
   (decimalPropertyOverride)
```

### Propriétés Héritées (de BaseDistributionDocumentLine et au-delà)

```typescript
✅ item: Reference<...>
✅ quantity: ...
✅ ... toutes les propriétés des parents
```

## 🔧 Logique de Parsing Améliorée

### Mécanisme de Skip des Décorateurs

```typescript
let inDecorator = false;
let decoratorParenCount = 0;

// Quand on voit @decorator
if (line.startsWith("@")) {
    inDecorator = true;
    decoratorParenCount = 0;
}

// On compte les parenthèses
if (inDecorator) {
    for (char of line) {
        if (char === "(") decoratorParenCount++;
        if (char === ")") decoratorParenCount--;
    }

    // Fin du décorateur quand toutes les parenthèses sont fermées
    if (decoratorParenCount === 0) {
        inDecorator = false;
    }

    continue; // Skip cette ligne !
}

// Maintenant on peut parser les vraies propriétés
```

## 🔍 Comment Tester

1. **Recharger VS Code complètement**

    ```
    Ctrl+Shift+P → "Developer: Reload Window"
    ```

2. **Ouvrir le workspace Xtrem**

    ```
    /xtrem-operations/second
    ```

3. **Refresh le parsing**

    ```
    Ctrl+Shift+P → "Xtrem Nodes Hierarchy: Refresh"
    ```

4. **Ouvrir la vue**

    ```
    Explorer → "Xtrem Nodes Hierarchy"
    ```

5. **Chercher BaseOutboundDocumentLine**

    ```
    Cliquer sur 🔍 → Upstream → BaseOutboundDocumentLine
    ```

6. **Vérifier la liste des propriétés**
   Vous devriez voir:
    - ✅ `document`
    - ✅ `itemCustomer`
    - ✅ `unit`
    - ✅ `unitToStockUnitConversionFactor`
    - ✅ Propriétés héritées
    - ❌ PAS de `isNullable`, `defaultValue`, `dependsOn`, etc.

## 📝 Changements Techniques

### Fichiers Modifiés

**src/nodeParser.ts:**

- `parseClassProperties()`: Ajout tracking des décorateurs avec comptage de parenthèses
- ✨ Nouvelle méthode `getAllProperties(nodeName)`: Collecte avec héritage
- Regex améliorée pour `override readonly`

**src/searchInput.ts:**

- Changement de `nodeClass.properties` vers `parser.getAllProperties()`
- Maintenant affiche toutes les propriétés incluant héritées

## ⚠️ Limitations Connues

- ❌ Les méthodes ne sont pas capturées (intentionnel)
- ❌ Les getters/setters ne sont pas inclus
- ❌ Les propriétés `static` ne sont pas détectées
- ❌ Les propriétés privées (`#prop`) ES2020 ne sont pas supportées

## 🚀 Prochaines Améliorations Possibles

- [ ] Migration vers TypeScript Compiler API (parser AST officiel)
- [ ] Support des getters/setters
- [ ] Indication visuelle des propriétés override vs héritées
- [ ] Filtrage par type de décorateur
- [ ] Export de la hiérarchie en JSON

---

**Version**: 0.0.4  
**Date**: 11 Février 2026  
**Status**: ✅ Testé et validé  
**Taille**: 18.91 KB  
**Improvements**: Parser robuste + Héritage + Skip décorateurs
