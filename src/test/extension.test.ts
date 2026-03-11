import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { getLooseMatchScore, splitIdentifierWords } from "../searchInput";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests.");

    test("Sample test", () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test("splitIdentifierWords splits camel case names", () => {
        assert.deepStrictEqual(splitIdentifierWords("PurchaseReceiptLine"), [
            "purchase",
            "receipt",
            "line",
        ]);
    });

    test("getLooseMatchScore matches spaced fragments against camel case", () => {
        const score = getLooseMatchScore("PurchaseReceiptLine", "rec lin");
        assert.notStrictEqual(score, null);
    });

    test("getLooseMatchScore prefers compact contiguous matches", () => {
        const bestScore = getLooseMatchScore("PurchaseReceiptLine", "rec lin");
        const weakerScore = getLooseMatchScore(
            "PurchaseReconciliationLine",
            "rec lin",
        );

        assert.notStrictEqual(bestScore, null);
        assert.notStrictEqual(weakerScore, null);
        assert.ok((bestScore ?? 0) > (weakerScore ?? 0));
    });

    test("getLooseMatchScore matches initials queries", () => {
        const score = getLooseMatchScore("PurchaseReceiptLine", "prl");
        assert.notStrictEqual(score, null);
    });

    test("getLooseMatchScore prefers exact initials over initials subsequence", () => {
        const bestScore = getLooseMatchScore("PurchaseReceiptLine", "prl");
        const weakerScore = getLooseMatchScore(
            "PurchaseOrderReleaseLine",
            "prl",
        );

        assert.notStrictEqual(bestScore, null);
        assert.notStrictEqual(weakerScore, null);
        assert.ok((bestScore ?? 0) > (weakerScore ?? 0));
    });

    test("getLooseMatchScore rejects unrelated queries", () => {
        assert.strictEqual(
            getLooseMatchScore("PurchaseReceiptLine", "foo bar"),
            null,
        );
    });
});
