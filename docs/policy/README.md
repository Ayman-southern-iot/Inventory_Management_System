# Policy documents

`Inventory-and-Procurement-Management-Policy.docx` is the deliverable. Its text lives in
`build-policy-docx.js`, which is the single source of truth: edit the script and regenerate.
Never hand-edit the `.docx`, or the two drift and nobody can tell which is current.

## Regenerating

The `docx` package is deliberately **not** a repo dependency, and `npm` must never be run at the
repo root (it deletes `node_modules/.pnpm`). Build it in a scratch directory instead. Node
resolves `require` from the *script's* own path, so the script has to be copied next to the
installed package, and the repo root is passed as the first argument:

```bash
mkdir -p /tmp/docgen && cd /tmp/docgen
npm init -y && npm install docx@9
cp "/d/Inventory Management System/ims/docs/policy/build-policy-docx.js" .
node build-policy-docx.js "/d/Inventory Management System/ims"
```

It writes `Inventory-and-Procurement-Management-Policy.docx` back into `docs/policy/`.

## Notes

- The letterhead logo is read from `apps/api/assets/letterhead/siot-logo.jpg`, the same asset the
  BOM PDF uses. Replacing that file changes both.
- The contents page is a Word TOC field. The document sets `updateFields`, so Word offers to
  populate it on first open; accept the prompt, or press Ctrl+A then F9.
- The prose contains no em dashes or en dashes by design. If you edit the script, keep it that way.
