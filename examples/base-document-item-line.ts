import type { decimal, Reference } from '@sage/xtrem-core';
import { decorators, NodeStatus, TextStream, useDefaultValue } from '@sage/xtrem-core';
import * as xtremSystem from '@sage/xtrem-system';
import * as xtremMasterData from '..';
import { BaseDocumentLine } from './base-document-line';

@decorators.subNode<BaseDocumentItemLine>({
    isVitalCollectionChild: true,
    isAbstract: true,
    isPublished: true,
    extends: () => BaseDocumentLine,
})
export class BaseDocumentItemLine extends BaseDocumentLine {
    getItem() {
        return this.item;
    }

    @decorators.referenceProperty<BaseDocumentItemLine, 'document'>({
        isPublished: true,
        isStored: true,
        isVitalParent: true,
        lookupAccess: true,
        node: () => xtremMasterData.nodes.BaseDocument,
    })
    override readonly document: Reference<xtremMasterData.nodes.BaseDocument>;

    /** To be deleted  */
    @decorators.stringPropertyOverride<BaseDocumentItemLine, 'documentNumber'>({
        async getValue() {
            return (await this.document).number;
        },
    })
    override readonly documentNumber: Promise<string>;

    /** To be deleted  */
    @decorators.integerPropertyOverride<BaseDocumentItemLine, 'documentId'>({
        async getValue() {
            return (await this.document)._id;
        },
    })
    override readonly documentId: Promise<number>;

    @decorators.enumProperty<BaseDocumentItemLine, 'origin'>({
        isStored: true,
        isPublished: true,
        dataType: () => xtremMasterData.enums.baseOriginDataType,
        defaultValue: () => 'direct',
        duplicatedValue: useDefaultValue,
    })
    readonly origin: Promise<xtremMasterData.enums.BaseOrigin>;

    @decorators.enumProperty<BaseDocumentItemLine, 'status'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        defaultValue: 'draft',
        duplicatedValue: useDefaultValue,
        dataType: () => xtremMasterData.enums.baseStatusDataType,
    })
    readonly status: Promise<xtremMasterData.enums.BaseStatus>;

    /** Will be move into base-dcoument-line in the future */
    @decorators.referenceProperty<BaseDocumentItemLine, 'site'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        dependsOn: [{ document: ['site'] }],
        ignoreIsActive: true,
        node: () => xtremSystem.nodes.Site,
        dataType: () => xtremSystem.dataTypes.site,
        async defaultValue() {
            const site = await (await this.document).site;
            const legalCompany = await site.legalCompany;
            if (site && (await site.isInventory)) {
                return site;
            }
            const inventorySite = await legalCompany.sites.takeOne(companySite => companySite.isInventory);
            if (inventorySite) {
                return inventorySite;
            }
            return null;
        },
        async control(cx, val) {
            await xtremSystem.events.control.isActive({
                nodeStatus: this.$.status,
                cx,
                oldSysId: this.$.status === NodeStatus.modified ? (await (await this.$.old).site)._id : null,
                val,
            });
        },
    })
    readonly site: Reference<xtremSystem.nodes.Site>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'siteLinkedAddress'>({
        isStored: true,
        isPublished: true,
        node: () => xtremMasterData.nodes.BusinessEntityAddress,
        dependsOn: ['site'],
        async defaultValue() {
            // eslint-disable-next-line prefer-destructuring
            const addresses = (await (await this.site).businessEntity).addresses; // using destructuring here will kill the upgrade
            return (await addresses.takeOne(async line => (await line.isActive) && line.isPrimary)) ?? null;
        },
        filters: {
            lookup: {
                async businessEntity() {
                    return (await (await this.site).businessEntity)._id;
                },
            },
        },
    })
    readonly siteLinkedAddress: Reference<xtremMasterData.nodes.BusinessEntityAddress>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'item'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        node: () => xtremMasterData.nodes.Item,
        dataType: () => xtremMasterData.dataTypes.item,
        ignoreIsActive: true,
        filters: {
            lookup: { isActive: true },
        },
        async control(cx, item) {
            if ((await this.status) !== 'closed' && (await (await this.document).status) !== 'posted') {
                await xtremMasterData.functions.controls.item.inactiveItemControl(cx, item);
            }
        },
    })
    readonly item: Reference<xtremMasterData.nodes.Item>;

    @decorators.stringProperty<BaseDocumentItemLine, 'itemDescription'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        dataSensitivityLevel: 'businessSensitive',
        anonymizeMethod: 'perCharRandom',
        dependsOn: ['item'],
        updatedValue: useDefaultValue,
        dataType: () => xtremSystem.dataTypes.description,
        async defaultValue() {
            return (await (await this.item)?.description) || (await this.item)?.name;
        },
    })
    readonly itemDescription: Promise<string>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'stockSite'>({
        isStored: true,
        isNullable: true,
        isPublished: true,
        lookupAccess: true,
        ignoreIsActive: true,
        filters: {
            control: {
                isInventory: true,
                async legalCompany(): Promise<number> {
                    return (await (await (await this.document)?.site)?.legalCompany)?._id;
                },
            },
        },
        dependsOn: [{ document: ['site', 'stockSite'] }],
        node: () => xtremSystem.nodes.Site,
        dataType: () => xtremSystem.dataTypes.site,
        async defaultValue() {
            return (await this.document)?.stockSite;
        },
    })
    readonly stockSite: Reference<xtremSystem.nodes.Site | null>;

    /** Not editable stockSiteLinkedAddress */
    @decorators.referenceProperty<BaseDocumentItemLine, 'stockSiteLinkedAddress'>({
        isNullable: true,
        isStored: true,
        isPublished: true,
        node: () => xtremMasterData.nodes.BusinessEntityAddress,
        dependsOn: ['stockSite'],
        lookupAccess: true,
        async defaultValue() {
            return (await this.stockSite)?.primaryAddress ?? null;
        },
        updatedValue: useDefaultValue,
    })
    readonly stockSiteLinkedAddress: Reference<xtremMasterData.nodes.BusinessEntityAddress | null>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'itemSite'>({
        isPublished: true,
        isNullable: true,
        dependsOn: ['item', 'site', 'stockSite'],
        join: {
            item() {
                return this.item;
            },
            async site() {
                return (await this.stockSite) ?? this.site;
            },
        },
        node: () => xtremMasterData.nodes.ItemSite,
        prefetch(record) {
            return {
                item: record.item,
                site: record.stockSite ?? record.site ?? record.document?.stockSite ?? record.document?.site,
            };
        },
    })
    readonly itemSite: Reference<xtremMasterData.nodes.ItemSite | null>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'stockUnit'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        filters: {
            control: {
                async type() {
                    const item = await this.item;
                    if ((await item?.type) === 'good' && (await item?.isStockManaged)) {
                        return { _nin: ['time', 'temperature'] };
                    }
                    return { _nin: ['temperature'] };
                },
            },
        },
        dependsOn: ['item'],
        updatedValue: useDefaultValue,
        node: () => xtremMasterData.nodes.UnitOfMeasure,
        dataType: () => xtremMasterData.dataTypes.unitOfMeasure,
        async defaultValue() {
            return (await this.item)?.stockUnit;
        },
    })
    readonly stockUnit: Reference<xtremMasterData.nodes.UnitOfMeasure>;

    @decorators.decimalProperty<BaseDocumentItemLine, 'quantityInStockUnit'>({
        isStored: true,
        isPublished: true,
        lookupAccess: true,
        dependsOn: ['unit', 'stockUnit', 'quantity'],
        dataType: () => xtremMasterData.dataTypes.quantityInStockUnit,
        async control(cx, val) {
            if (val <= 0) {
                cx.error.addLocalized(
                    '@sage/xtrem-master-data/nodes__base_document_item_line__quantity_positive_value',
                    'You need to select or enter a quantity that is greater than 0.',
                );
            }
        },
        updatedValue: useDefaultValue,
        async defaultValue() {
            return xtremMasterData.functions.convertFromTo(await this.unit, await this.stockUnit, await this.quantity);
        },
    })
    readonly quantityInStockUnit: Promise<decimal>;

    @decorators.decimalProperty<BaseDocumentItemLine, 'unitToStockUnitConversionFactor'>({
        isStored: true,
        isPublished: true,
        isNotZero: true,
        dependsOn: ['item', 'unit', 'stockUnit'],
        lookupAccess: true,
        dataType: () => xtremMasterData.dataTypes.unitConversionCoefficient,
        async control(cx, val) {
            await cx.error.if(val).is.negative();
            await cx.error.if(val).is.zero();
        },
        async defaultValue() {
            return xtremMasterData.functions.getConvertCoefficient(await this.unit, await this.stockUnit);
        },
    })
    readonly unitToStockUnitConversionFactor: Promise<decimal>;

    @decorators.referenceProperty<BaseDocumentItemLine, 'unit'>({
        isStored: true,
        isPublished: true,
        isRequired: true,
        dependsOn: ['item'],
        node: () => xtremMasterData.nodes.UnitOfMeasure,
        dataType: () => xtremMasterData.dataTypes.unitOfMeasure,
        async defaultValue() {
            return (await this.item)?.stockUnit;
        },
        lookupAccess: true,
    })
    readonly unit: Reference<xtremMasterData.nodes.UnitOfMeasure>;

    @decorators.decimalProperty<BaseDocumentItemLine, 'quantity'>({
        isStored: true,
        isPublished: true,
        dependsOn: ['unit'],
        dataType: () => xtremMasterData.dataTypes.quantityInUnit,
        control(cx, val) {
            if (val <= 0) {
                cx.error.addLocalized(
                    '@sage/xtrem-master-data/nodes__base_document_item_line__quantity_positive_value',
                    'You need to select or enter a quantity that is greater than 0.',
                );
            }
        },
    })
    readonly quantity: Promise<decimal>;

    @decorators.textStreamProperty<BaseDocumentItemLine, 'internalNote'>({
        isPublished: true,
        isStored: true,
        dataSensitivityLevel: 'personal',
        anonymizeMethod: 'fixed',
        anonymizeValue: TextStream.fromString('*'.repeat(15)),
        defaultValue: TextStream.empty,
        duplicatedValue: useDefaultValue,
        dataType: () => xtremMasterData.dataTypes.note,
    })
    readonly internalNote: Promise<TextStream>;

    @decorators.textStreamProperty<BaseDocumentItemLine, 'externalNote'>({
        isPublished: true,
        isStored: true,
        dataSensitivityLevel: 'personal',
        anonymizeMethod: 'fixed',
        anonymizeValue: TextStream.fromString('*'.repeat(15)),
        defaultValue: TextStream.empty,
        duplicatedValue: useDefaultValue,
        dataType: () => xtremMasterData.dataTypes.note,
        async control(cx) {
            await xtremMasterData.events.control.externalNoteControl.externalNoteEmpty(
                await this.isExternalNote,
                await this.externalNote,
                cx,
            );
        },
    })
    readonly externalNote: Promise<TextStream>;

    /** to be sure the user know that externalNode will go to external documents */
    @decorators.booleanProperty<BaseDocumentItemLine, 'isExternalNote'>({
        isPublished: true,
        isStored: true,
        defaultValue: false,
        duplicatedValue: useDefaultValue,
    })
    readonly isExternalNote: Promise<boolean>;

    @decorators.booleanProperty<BaseDocumentItemLine, 'forceUpdateForStock'>({
        defaultValue: false,
    })
    readonly forceUpdateForStock: Promise<boolean>;
}
