/**
 * Example Xtrem Node Hierarchy
 * This file demonstrates the patterns recognized by the Xtrem Nodes Hierarchy extension
 */

import { decorators, ui } from "@sage/xtrem-framework";

// ============================================================================
// Base Node Definition
// ============================================================================

@decorators.node()
export class BaseDocumentItemLine {
    @ui.decorators.property({
        label: "Unit",
        required: true,
    })
    unit: string;

    @decorators.referenceProperty({
        refNode: "ItemMaster",
        dependsOn: ["itemId"],
    })
    itemRef: string;

    @ui.decorators.property({
        label: "Quantity",
        defaultValue: 1,
    })
    quantity: number;
}

// ============================================================================
// Intermediate Node (extends base, adds new properties)
// ============================================================================

@decorators.node()
export class BaseOutboundDocumentLine extends BaseDocumentItemLine {
    // Override inherited property
    @decorators.referenceProperty({
        refNode: "ItemMaster",
        dependsOn: ["itemId", "warehouse"],
        defaultValue: "DEFAULT",
    })
    itemRef: string;

    @ui.decorators.property({
        label: "Warehouse",
        required: true,
    })
    warehouse: string;

    @decorators.property({
        label: "Serial Number",
    })
    serialNumber: string;
}

// ============================================================================
// Concrete Node (extends intermediate, specialized for specific use case)
// ============================================================================

@decorators.subNode()
export class SalesOrderLine extends BaseOutboundDocumentLine {
    // Override the unit property with sales-specific parameters
    @ui.decorators.property({
        label: "Unit",
        required: true,
        defaultValue: "UNIT",
    })
    unit: string;

    @ui.decorators.property({
        label: "Discount %",
        defaultValue: 0,
    })
    discountPercent: number;
}

// ============================================================================
// Another Concrete Node (extends base, different specialization)
// ============================================================================

@decorators.subNode()
export class PurchaseOrderLine extends BaseOutboundDocumentLine {
    @ui.decorators.property({
        label: "Lead Time (days)",
        defaultValue: 0,
    })
    leadTimeDays: number;

    @decorators.referenceProperty({
        refNode: "Supplier",
        dependsOn: ["supplierId"],
    })
    supplier: string;
}

// ============================================================================
// Example Usage with Extension
// ============================================================================

/*
EXAMPLE SEARCHES:

1. Search for "unit" property in "BaseOutboundDocumentLine" (upstream)
   Result shows:
   - BaseDocumentItemLine (original definition)
   - BaseOutboundDocumentLine (inherited, no override)
   - SalesOrderLine (revised with different params)

2. Search for "unit" property in "SalesOrderLine" (upstream)
   Result shows:
   - BaseDocumentItemLine (original definition)
   - SalesOrderLine (revised definition)

3. Search for "itemRef" property in "BaseDocumentItemLine" (downstream)
   Result shows all classes that inherit this property:
   - BaseOutboundDocumentLine (inherited)
   - SalesOrderLine (inherited)
   - PurchaseOrderLine (inherited)
   - Possibly others

4. Search for "itemRef" property in "BaseOutboundDocumentLine" (downstream)
   Result shows:
   - SalesOrderLine (inherited, uses parent's version)
   - PurchaseOrderLine (inherited, uses parent's version)

PATTERNS DEMONSTRATED:

✓ Simple properties with @ui.decorators.property()
✓ Reference properties with @decorators.referenceProperty()
✓ Properties with parameters (label, required, defaultValue, etc.)
✓ Single-level inheritance (extends)
✓ Multi-level inheritance chains
✓ Property overrides in child classes
✓ @decorators.node() for main classes
✓ @decorators.subNode() for specialized classes
*/
