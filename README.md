# Xtrem Nodes Hierarchy

A VS Code extension that allows you to explore the property inheritance hierarchy of Xtrem framework nodes.

## Features

- **Custom Tree View**: Interactive explorer in the sidebar for viewing node property hierarchies
- **Upstream Search**: Discover where a property is originally defined in parent classes
- **Downstream Search**: Find all child classes that override or use a property
- **Property Tracking**: View all decorators and parameters associated with a property across the inheritance chain
- **File Navigation**: Click on any node or property revision to jump directly to its definition in the code

## How to Use

### Opening the View

1. The "Xtrem Nodes Hierarchy" view is automatically added to the Explorer sidebar
2. Click on the search icon (🔍) in the view header to start searching

### Searching for a Property

1. **Basic Search**:
    - Click the search button in the view header
    - Select the direction: Upstream (parent classes) or Downstream (child classes)
    - Choose a Xtrem node from the quick pick
    - Select a property name

2. **Viewing Results**:
    - The hierarchy chain is displayed showing all classes in the inheritance path
    - Nodes that override the property are marked with "(revised)"
    - Click on any node to jump to its file definition

### Understanding the Results

- **Upstream Search**: Shows where the property is first defined and all classes that inherit it
- **Downstream Search**: Shows all child classes that override or inherit the property
- **Revisions**: Properties that have been redefined show their decorator parameters at each level

### Commands

- **Search Node Property**: Open advanced search dialog
- **Refresh**: Re-parse the workspace for the latest node definitions

## Example Workflow

1. Search for node `BaseOutboundDocumentLine` and property `unit`
2. Select "Upstream Search"
3. View shows:
    - `BaseDocumentItemLine` (original definition)
    - `BaseOutboundDocumentLine` (revised with different parameters)
4. Click on each revision to see the full decorator parameters
5. Click on node names to navigate to the source code

## Architecture

- **nodeParser.ts**: Parses TypeScript files to extract node definitions and properties
- **hierarchyProvider.ts**: Tree data provider for the VS Code tree view
- **searchInput.ts**: Handles user search input and interaction
- **extension.ts**: Main extension entry point and command registration

## Requirements

- VS Code 1.109.0 or higher
- Xtrem framework project with standard `@decorators.node` or `@decorators.subNode` patterns
- Node definitions must be in `nodes/` or `node-extensions/` directories

## Notes

- The extension scans TypeScript files in `**/nodes/**` and `**/node-extensions/**` directories only
- Nodes must be decorated with `@decorators.node` or `@decorators.subNode` to be recognized
- Properties must use standard Xtrem decorator patterns (e.g., `@ui.decorators.property`, `@decorators.referenceProperty`)
- The parser supports multiple decorator patterns: `@decorators.node()`, `@node()`, `@ui.decorators.property()`, `@property()`, etc.
