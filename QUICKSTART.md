# Xtrem Nodes Hierarchy - Quick Start Guide

## Installation & Launch

### 1. Open in VS Code

```bash
# Navigate to the extension directory
cd /home/cchaize/formations/vs-code-extension/nodesHierarchy/xtrem-nodes-hierarchy

# Open in VS Code
code .
```

### 2. Run the Extension

**Option A: Debug Mode (with breakpoints)**

- Press `F5` to start the debugger
- A new VS Code window opens with the extension loaded
- Open the Command Palette (`Ctrl+Shift+P`) and search for "Xtrem Nodes Hierarchy"

**Option B: Production Build**

```bash
npm run package  # Build the extension
npm run test     # Run tests (optional)
```

## Using the Extension

### First Time Setup

1. The extension automatically parses your workspace on startup
2. Look for "**Xtrem Nodes Hierarchy**" view in the Explorer sidebar (usually on the left)
3. You should see a message like "Search for a node property..."

### Perform a Search

#### Method 1: Using the Search Button

1. Click the 🔍 search button in the "Xtrem Nodes Hierarchy" view header
2. Choose search direction:
    - **⬆️ Upstream**: Find where property is originally defined
    - **⬇️ Downstream**: Find all child classes using this property
3. Select a Xtrem node from the list
4. Select a property from that node
5. View the hierarchy chain in the tree

#### Method 2: Using Command Palette

1. Press `Ctrl+Shift+P` to open Command Palette
2. Type "Xtrem" to see available commands:
    - "Xtrem Nodes Hierarchy: Search"
    - "Xtrem Nodes Hierarchy: Search Upstream"
    - "Xtrem Nodes Hierarchy: Search Downstream"
    - "Xtrem Nodes Hierarchy: Refresh"

### Understanding Results

```
Property: unitName
├── BaseDocumentItemLine
│   └── @property { label: "Unit", required: true }
│       Line 45 in baseDocument.ts
│
├── BaseOutboundDocumentLine (revised)
│   └── @property { label: "Unit", defaultValue: "UNIT" }
│       Line 78 in outbound.ts
│
└── SalesOrderLine (revised)
    └── @property { label: "Unit", required: true, defaultValue: "EACH" }
        Line 102 in sales.ts
```

**How to Read This:**

- `BaseDocumentItemLine` - Original property definition
- `BaseOutboundDocumentLine (revised)` - Child class that overrides the property
- `SalesOrderLine (revised)` - Grandchild class with its own version
- Each decorator shows what parameters were set at that level

### Navigate to Source Code

Click on any node or property in the tree to:

- Open the source file in your editor
- Jump directly to the class/decorator definition
- Line numbers are shown in the tree items

## Keyboard Shortcuts

| Action                        | Shortcut                             |
| ----------------------------- | ------------------------------------ |
| Open Command Palette          | `Ctrl+Shift+P`                       |
| Search (from Command Palette) | Type "Xtrem"                         |
| Refresh workspace parsing     | `Ctrl+Shift+P` → "Xtrem ... Refresh" |
| Open file from tree           | Click on any item                    |

## Troubleshooting

### "No Xtrem nodes found"

- **Problem**: Extension doesn't detect any nodes
- **Solution**:
    - Ensure workspace contains TypeScript files with `@decorators.node()` decorators
    - Check that decorator is exactly `@decorators.node()` or `@decorators.subNode()`
    - Try the Refresh command (`Ctrl+Shift+P` → "Xtrem ... Refresh")

### "Property not found"

- **Problem**: Property isn't showing in the search results
- **Reason**: Property might not be defined in the selected node or its hierarchy
- **Solution**:
    - Check the exact property name (case-sensitive)
    - Verify property uses standard Xtrem decorator patterns
    - Check parent/child classes

### Extension not loading

- **Problem**: "Xtrem Nodes Hierarchy" view doesn't appear
- **Solution**:
    - Check Debug Console for errors (`Ctrl+Shift+U` → "Debug Console")
    - Run `npm run compile` to rebuild
    - Reload VS Code (`Ctrl+R` on the extension window)

### Parser seems slow

- **Problem**: Taking long to parse large workspaces
- **Current**: Extension uses file system scan + regex parsing
- **Workaround**:
    - Open a folder with fewer files
    - Exclude node_modules in workspace settings

## Example Workflows

### Workflow 1: Trace Property Origins

_Goal: Find where a property was first defined_

1. Open your node file (e.g., `SalesOrderLine`)
2. Find a property you want to investigate
3. Open Xtrem Nodes Hierarchy view
4. Search for that property with **Upstream** direction
5. See the complete inheritance chain from root to current node

**Real Example:**

- Node: `SalesOrderLine`
- Property: `unit`
- Result shows it originates in `BaseDocumentItemLine` and is redefined in `SalesOrderLine`

### Workflow 2: Find All Variants

_Goal: See all different versions of a property across the hierarchy_

1. Open a base/intermediate node (e.g., `BaseOutboundDocumentLine`)
2. Select a property that might be overridden
3. Choose **Downstream** search
4. See all child classes and their property definitions
5. Compare parameters across different implementations

**Real Example:**

- Node: `BaseDocumentItemLine`
- Property: `unit`
- Result shows overrides in `SalesOrderLine` and `PurchaseOrderLine`

## Configuration

Currently, the extension works with default settings. Future versions may support:

- Custom workspace root for scanning
- Filtering by node type
- Custom decorator patterns

Check `.github/copilot-instructions.md` for development roadmap.

## Tips & Best Practices

✅ **DO:**

- Use standard Xtrem decorator patterns
- Keep property names consistent across hierarchy
- Use meaningful property/class names
- Check the Examples file to see supported patterns

❌ **DON'T:**

- Use non-standard decorator syntax
- Mix different property definition styles
- Put decorators on non-property class members
- Use special characters in property names

## Next Steps

1. **Explore Your Codebase**: Choose a well-known node and trace a property
2. **Check Examples**: Look at `EXAMPLES.ts` for supported patterns
3. **Report Patterns Not Working**: If you use a pattern not shown in EXAMPLES.ts, it needs parser improvement

## Getting Help

1. Check the main [README.md](./README.md) for detailed documentation
2. Review `.github/copilot-instructions.md` for development details
3. Look at `EXAMPLES.ts` for supported TypeScript patterns
4. Check the Debug Console for error messages

---

**Happy exploring!** 🧭
