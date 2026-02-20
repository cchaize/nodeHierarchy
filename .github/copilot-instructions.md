# Xtrem Nodes Hierarchy Extension - Development Guide

This VS Code extension provides tools for exploring the property inheritance hierarchy of Xtrem framework nodes.

## Project Overview

**Purpose**: Enable developers to easily understand and trace property definitions and modifications across the Xtrem node inheritance hierarchy.

**Key Features**:

- Interactive tree view in VS Code Explorer sidebar
- Upstream search: finding property origin in parent classes
- Downstream search: finding property usage in child classes
- Direct navigation from properties to source code
- Decorator parameter tracking through inheritance chain

## Architecture

### Core Components

1. **nodeParser.ts** - TypeScript AST analysis
    - Scans workspace for TypeScript files
    - Extracts node definitions (@decorators.node, @decorators.subNode)
    - Parses property decorators and parameters
    - Builds inheritance relationships

2. **hierarchyProvider.ts** - VS Code TreeDataProvider
    - Manages tree view rendering
    - Formats hierarchy chains for display
    - Handles file navigation commands

3. **searchInput.ts** - User interaction layer
    - Quick pick dialogs for node/property selection
    - Search direction selection (upstream/downstream)
    - User feedback and error handling

4. **extension.ts** - Extension lifecycle
    - Command registration
    - View initialization
    - Workspace parsing trigger

5. **types.ts** - TypeScript interfaces
    - PropertyInfo, NodeClass, HierarchyChain definitions
    - Ensures type safety across modules

## Development Workflow

### Current State

- ✅ Project scaffolded with Yeoman generator
- ✅ Core parsing logic implemented
- ✅ Tree view provider created
- ✅ Search interface implemented
- ✅ All files compiled successfully
- ✅ Initial documentation complete

### Next Steps (Future Enhancements)

1. **Pattern Recognition Improvements**
    - Support for more complex decorator patterns
    - Validation of Xtrem-specific patterns
    - Fallback parsing strategies

2. **UI Enhancements**
    - Custom icons for different decorator types
    - Collapsible sections for large hierarchies
    - Search history / recent searches

3. **Performance Optimization**
    - Incremental parsing for large workspaces
    - Workspace change detection
    - Caching improvements

4. **Testing**
    - Unit tests for parser logic
    - Integration tests for tree view
    - End-to-end test scenarios

5. **Documentation**
    - Decorator pattern examples
    - Troubleshooting guide
    - Video tutorials

## Xtrem Framework Integration

### Supported Patterns

The extension recognizes these decorator patterns:

```typescript
// Node declaration
@decorators.node()
export class MyNode {
  @ui.decorators.property()
  myProperty: string;

  @decorators.referenceProperty({ ... })
  refProp: SomeNode;
}

// Sub-node
@decorators.subNode()
export class MySubNode extends MyNode {
  @decorators.referenceProperty({ ... })
  refProp: DifferentNode; // Override
}
```

### Property Attributes Tracked

- Decorator type (property, referenceProperty, compositeProperty, etc.)
- Decorator parameters (mapped as key-value pairs)
- Original declaration location
- All override locations in the inheritance chain

## Building and Testing

### Build Process

```bash
# Install dependencies
npm install

# Check types
npm run check-types

# Lint code
npm run lint

# Development build (with watch)
npm run watch

# Production build
npm run package

# Run tests
npm run test
```

### Package Contents

- `src/` - TypeScript source files
- `dist/` - Compiled JavaScript output
- `.vscode/` - VS Code configuration (launch, tasks)
- `package.json` - NPM metadata and scripts
- `tsconfig.json` - TypeScript configuration
- `eslint.config.mjs` - ESLint rules
- `esbuild.js` - Build configuration

## Code Style

- **Language**: TypeScript (strict mode)
- **Linter**: ESLint with recommended rules
- **Formatting**: Curly braces required for all blocks
- **Naming**: camelCase for variables/functions, PascalCase for classes

## Extension Commands

### Registered Commands

- `xtrem-nodes-hierarchy.search` - Open advanced search dialog
- `xtrem-nodes-hierarchy.searchUpstream` - Quick upstream search
- `xtrem-nodes-hierarchy.searchDownstream` - Quick downstream search
- `xtrem-nodes-hierarchy.refresh` - Refresh workspace parsing

### Key Bindings

No default keybindings; use Command Palette (`Ctrl+Shift+P`) to access commands.

## Debugging

### Debug Configuration

The project includes a VS Code debug configuration:

1. Press `F5` to start the extension in debug mode
2. A new VS Code window opens with the extension loaded
3. Set breakpoints in your code
4. Check output in the Debug Console

### Common Issues

1. **No nodes found**: Ensure workspace contains files with `@decorators.node`
2. **Properties not appearing**: Check property decorator syntax
3. **Navigation not working**: Verify file paths are absolute

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TreeDataProvider Documentation](https://code.visualstudio.com/api/extension-guides/tree-view)
- [TypeScript Compiler API](https://www.typescriptlang.org/docs/handbook/compiler-api.html)
- [Xtrem Framework Documentation](https://your-xtrem-docs-link)

## Contributing Guidelines

When adding new features:

1. Maintain type safety - use TypeScript strictly
2. Follow existing code patterns
3. Update tests and documentation
4. Ensure all linting passes
5. Test locally before committing

## Known Limitations

- Parser is regex-based, not AST-based (current limitation)
- Complex nested decorators may not parse correctly
- Performance may degrade with very large workspaces (>10k files)
- Some advanced TypeScript patterns may not be recognized

## Future Considerations

- Migrate to proper TypeScript Parser API for more reliable parsing
- Implement workspace change listeners for real-time updates
- Add settings for customizing parser behavior
- Create marketplace listing and versioning strategy
