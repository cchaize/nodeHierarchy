/**
 * Example Xtrem Node Hierarchy
 * This file demonstrates the patterns recognized by the Xtrem Nodes Hierarchy extension
 */

import { decorators, ui } from "@sage/xtrem-framework";

// ============================================================================
// Base Node Definition defined in xtrem-master-data package
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
// Intermediate Node (extends base, adds new properties) defined in xtrem-distribution package
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
// Concrete Node (extends intermediate, specialized for specific use case) defined in xtrem-sales package
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
// Another Concrete Node (extends base, different specialization) defined in xtrem-purchasing package
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

Legend:
* the property is defined/override
- the property is not defined/override but inherited from parent class

1. Search for "unit" property in "BaseOutboundDocumentLine" (upstream)
   Result shows:
    - BaseOutboundDocumentLine (xtrem-distribution)
        * BaseDocumentItemLine (xtrem-master-data)
   
2. Search for "unit" property in "SalesOrderLine" (upstream)
   Result shows:
    * SalesOrderLine (revised definition)
        - BaseOutboundDocumentLine (xtrem-distribution)
            * BaseDocumentItemLine (xtrem-master-data)

3. Search for "itemRef" property in "BaseDocumentItemLine" (downstream)
   Result shows all classes that inherit this property:
    * BaseDocumentItemLine (xtrem-master-data)
        * BaseOutboundDocumentLine (xtrem-distribution)
            - SalesOrderLine (xtrem-sales)
            - PurchaseOrderLine (xtrem-purchasing)
   (Possibly others)

4. Search for "itemRef" property in "BaseOutboundDocumentLine" (downstream)
   Result shows:
    * BaseOutboundDocumentLine (xtrem-distribution)
        - SalesOrderLine (xtrem-sales)
        - PurchaseOrderLine (xtrem-purchasing)
   (Possibly others)

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
