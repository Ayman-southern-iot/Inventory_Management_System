/**
 * Every user-visible string in the app. No literal copy in JSX (rules/30-frontend.md) — not for
 * translation, but so a wording change is one file and QA can diff the copy.
 */
export const t = {
  app: {
    name: 'Southern IoT',
    shortName: 'Southern IoT',
    /** Login-page-only blurb clarifying the acronym. */
    acronym: 'IOT — Innovation of Technology',
    tagLine: 'Inventory & Procurement',
  },

  common: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    create: 'Create',
    edit: 'Edit',
    close: 'Close',
    search: 'Search',
    retry: 'Try again',
    clear: 'Clear',
    loading: 'Loading…',
    none: '—',
    yes: 'Yes',
    no: 'No',
    active: 'Active',
    inactive: 'Inactive',
    all: 'All',
    optional: 'optional',
    required: 'Required',
    page: 'Page',
    of: 'of',
    previous: 'Previous',
    next: 'Next',
    results: 'results',
    add: 'Add',
    back: 'Back',
    description: 'Description',
    note: 'Note',
    filters: 'Filters',
    unknown: 'Unknown',
    manage: 'Manage',
    dash: '—',
  },

  states: {
    errorTitle: 'Something went wrong',
    errorBody: 'The request did not complete. This is usually temporary.',
    emptyTitle: 'Nothing here yet',
    offlineTitle: 'Cannot reach the server',
    offlineBody: 'Check your connection, then try again.',
    notFoundTitle: 'Page not found',
    notFoundBody: 'That page does not exist, or you do not have access to it.',
    forbiddenTitle: 'Not allowed',
    forbiddenBody: 'Your account does not have permission to view this page.',
    crashTitle: 'This screen crashed',
    crashBody: 'Reloading usually fixes it. If it keeps happening, tell an administrator.',
    reload: 'Reload the page',
  },

  auth: {
    signInTitle: 'Sign in',
    signInSubtitle: 'Use the account your administrator created for you.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signOut: 'Sign out',
    invalidCredentials: 'Email or password is incorrect.',
    accountDeactivated: 'This account has been deactivated. Contact an administrator.',
    rateLimited: 'Too many attempts. Wait a few minutes and try again.',
    sessionExpired: 'Your session expired. Please sign in again.',
    changePasswordTitle: 'Change your password',
    changePasswordForced: 'You must set a new password before continuing.',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordMismatch: 'The two passwords do not match.',
    passwordChanged: 'Password changed.',
    passwordRules: 'At least 4 characters.',
    // Dev-only block under the sign-in form (Phase 05). Never ships to production.
    // Shown only when the server has DEMO_ACCOUNTS_ENABLED on; the list is read live from the
    // database, so users added or renamed in the admin panel appear here without a redeploy.
    demoAccountsTitle: 'Demo accounts',
    demoAccountsPasswordLabel: 'Password for every account below:',
    demoAccountsCaveat:
      'Anyone who can open this page can sign in as any of these people. Turn demo mode off before this system holds anything real. If an administrator changes one account’s password, that account no longer uses the password above.',
  },

  nav: {
    dashboard: 'Dashboard',
    inventory: 'Inventory',
    borrowing: 'Borrowing',
    myBorrowings: 'My borrowings',
    myRequisitions: 'My requisitions',
    projects: 'Projects',
    allRequisitions: 'All requisitions',
    approvals: 'Approvals',
    expenses: 'Expenses',
    admin: 'Administration',
    adminUsers: 'Users',
    adminDepartments: 'Departments',
    adminSettings: 'Settings',
    adminAuditLog: 'Audit log',
    account: 'My account',
    inventoryProducts: 'Inventory',
    inventoryCategories: 'Categories',
    inventoryLocations: 'Locations',
    boms: 'Bills of Materials',
  },

  roles: {
    GENERAL: 'General',
    APPROVER: 'Approver',
    INVENTORY_MANAGER: 'Inventory Manager',
    ADMIN: 'Administrator',
  },

  dashboard: {
    title: 'Dashboard',
    welcome: 'Signed in as',
    yourRoles: 'Your roles',
    department: 'Department',
    designation: 'Designation',
    phaseNotice:
      'Inventory, borrowing, requisitions and Bills of Materials are all live. Your roles decide what appears in the sidebar.',

    /*
     * The personal record. Every label says whose figures these are without repeating "your" on
     * each tile — the section headings carry it, so the numbers stay scannable.
     */
    yourRecord: 'Your record',
    yourRecordHint: 'Only you can see this.',

    /*
     * Plain words over precise ones, on Ayman's instruction (2026-09-01). This is the first
     * screen everybody sees and several of these labels were written for somebody who already
     * knew the domain — "In flight", "Actually spent", "On transportation". Every label here now
     * says what it is in words anyone in the office would use.
     */
    requisitionsHeading: 'Requisitions',
    requisitionsHint: '{n} raised in total.',
    groupInMotion: 'Still going on',
    groupSettled: 'Finished',
    raised: 'Raised',
    inFlight: 'Waiting for approval',
    draftsCount: 'Not sent yet',
    approvedCount: 'Approved',
    rejectedCount: 'Rejected',
    cancelledCount: 'Cancelled',

    borrowingHeading: 'Borrowing',
    borrowingHint: '{n} items borrowed in total.',
    groupWhereTheyAre: 'Where they are',
    groupHowTheyCameBack: 'How they came back',
    borrowedCount: 'Borrowed',
    stillOut: 'Still with you',
    returnedCount: 'Given back',
    // Units, not requests: three of five cables back damaged is three, and the copy has to be
    // unambiguous about that or the number reads as "three separate borrowings".
    partiallyDamagedUnits: 'Came back partly damaged',
    damagedUnits: 'Came back damaged',
    notWorkingUnits: 'Came back not working',
    unitsSuffix: 'units',

    spendHeading: 'Money',
    /*
     * Four figures, each named in full, on Ayman's instruction (2026-09-01).
     *
     * The card used to show a derived "Actually spent" with its two halves listed underneath —
     * a total and its own components side by side, leaving the reader to work out which was
     * which. Purchasing plus transportation is what left the company; anybody who wants that sum
     * can add two numbers, and nobody has to decode a label to get there.
     */
    spendRequested: 'Total Money Requested',
    spendApproved: 'Total Money Approved',
    spendPurchased: 'Total Money in Purchasing',
    spendTransportation: 'Total Transportation',
    spendHint: 'What you asked for, what was approved, and what has actually been paid out.',

    /** Shown in place of a block when the person has nothing in it yet. */
    nothingYet: 'Nothing yet.',
  },

  users: {
    title: 'Users',
    subtitle: 'Create accounts, assign roles, and set the designation that prints on the BOM.',
    newUser: 'New user',
    editUser: 'Edit user',
    fullName: 'Full name',
    email: 'Email',
    designation: 'Designation',
    designationHint: 'Printed on the BOM approval block, so use the real job title.',
    department: 'Department',
    noDepartment: 'No department',
    roles: 'Roles',
    rolesHint: 'Roles are additive. Everyone keeps General.',
    password: 'Initial password',
    mustChangePassword: 'Require a password change at first sign-in',
    status: 'Status',
    lastLogin: 'Last sign-in',
    neverSignedIn: 'Never',
    activate: 'Activate',
    deactivate: 'Deactivate',
    resetPassword: 'Reset password',
    showInactive: 'Show deactivated',
    searchPlaceholder: 'Search by name, email or designation',
    created: 'User created.',
    updated: 'User updated.',
    activated: 'User activated.',
    deactivated: 'User deactivated.',
    passwordReset: 'Password reset. Give the new password to the user directly.',
    emptyTitle: 'No users match this filter',
  },

  departments: {
    title: 'Departments',
    subtitle: 'Departments group users and can override the default approver slots.',
    newDepartment: 'New department',
    editDepartment: 'Edit department',
    name: 'Name',
    members: 'Active members',
    created: 'Department created.',
    updated: 'Department updated.',
    emptyTitle: 'No departments yet',
    emptyBody: 'Create one before assigning users to it.',
  },

  settings: {
    title: 'Settings',
    subtitle: 'Business rules that take effect immediately, without a redeploy.',
    expenseThreshold: 'Expense threshold',
    expenseThresholdHint:
      'Requisitions at or above this amount need the higher number of approvers.',
    approverSlotsBelow: 'Approvers below the threshold',
    approverSlotsAtOrAbove: 'Approvers at or above the threshold',
    lastChanged: 'Last changed',
    by: 'by',
    never: 'never changed',
    saved: 'Setting saved.',
    approverSlotsTitle: 'Approver slots',
    approverSlotsSubtitle:
      'Who fills Approver 1 and Approver 2. A department setting overrides the company default.',
    companyDefault: 'Company default',
    slot: 'Approver',
    unassigned: 'Not assigned',
    slotSaved: 'Approver slot saved.',
    onlyApprovers: 'Only users with the Approver role can be assigned.',
    /**
     * Phase 05: a single admin-designated approver handles all sub-threshold requisitions
     * (those below the expense threshold). Previously the count + slot 1 was used, but slot 1
     * is also part of the at-or-above chain — reassigning slot 1 would silently change who
     * approves the sub-threshold case.
     */
    subthresholdApprover: 'Sub-threshold approver',
    subthresholdApproverHint:
      'Approves every requisition below the threshold. Required before sub-threshold requisitions can be submitted.',
    slotHeldByInactive:
      'This slot points at a deactivated user. New requisitions will refuse until it is reassigned or the user is reactivated.',
    slotHeldByInactiveWarning:
      'Slot is held by an inactive user — submissions will be refused.',
    /**
     * Audit log configuration. The audit recording set is an explicit allow-list rather than a
     * blacklist so turning actions back on does not silently recover history that was disabled
     * — the never-recorded entries stay gone (see AUDIT_ENABLED_ACTIONS in registry.ts).
     */
    auditEnabledActions: 'Audit recorded actions',
    auditEnabledActionsHint:
      'Actions the audit log records. Always-on entries cannot be turned off; turning the others off stops future recording only.',
    auditActionsSelectedSummary: (count: number, total: number) =>
      `${count} of ${total} actions selected`,
    auditAlwaysOn: 'Always on',
    auditAlwaysOnHint: 'Recorded no matter what. Cannot be turned off.',
    auditSelectAll: 'Select all',
    auditClearOptional: 'Clear optional',
    /**
     * Retention presets match AUDIT_RETENTION_PRESETS in the shared registry; the labels here
     * exist so the admin UI can show them in plain English without an inline map.
     */
    auditRetentionDays: 'Audit history retention',
    auditRetentionDaysHint:
      'How long the audit log is kept before the nightly job purges it. Forever keeps everything.',
    auditRetentionForever: 'Forever',
  },

  inventory: {
    // 'Inventory', matching the sidebar item it is reached from (Ayman, 2026-09-01). D-010 made
    // the heading follow the sidebar rather than differ from it; that still holds, the sidebar
    // has simply been renamed. Its siblings are Categories and Locations.
    title: 'Inventory',
    // EX-02: requirements section 10 asks for inventory records exportable for Accounts.
    downloadCsv: 'Export CSV',
    downloadPdf: 'Export PDF',
    subtitle: 'The stock register. Every movement is recorded and cannot be edited afterwards.',
    // list
    searchPlaceholder: 'Search by name or storage ID',
    newProduct: 'New product',
    editProduct: 'Edit product',
    productCode: 'Storage ID',
    name: 'Name',
    category: 'Category',
    unit: 'Unit',
    onHand: 'On hand',
    reserved: 'Reserved',
    available: 'Available',
    /**
     * One-sentence gloss for "Available": what it is, what it is not. The number alone is
     * misleading — it conflates "free to lend" with "physically present, but held back". The
     * parentheticals point at the two reductions that subtract from on-hand to get here.
     */
    availableHint: 'On hand minus reserved minus quarantined.',
    /**
     * "Currently in use" / "In project use" — the headline of the section that lists active
     * borrows on the product detail page. The list row label says "Currently in use" (more
     * natural English) while the figure label says "In project use" (less ambiguous about
     * what kind of use). Both come out of the same column.
     */
    inProjectUse: 'In project use',
    /**
     * "Total owned" — the headline figure for an IM looking at the product card. Sum of the
     * physical on-hand and the outstanding (issued but not returned) units. The product card
     * shows it next to On hand so the comparison is obvious.
     */
    totalOwned: 'Total owned',
    totalOwnedHint: 'On hand plus what is currently out on borrow.',
    quarantined: 'Quarantined',
    quarantinedHint:
      'Units on the shelf but excluded from available — damaged returns wait here for review.',
    availableShort: 'available',
    allCategories: 'All categories',
    inStockOnly: 'In stock only',
    showInactive: 'Show archived',
    emptyTitle: 'No products match this filter',
    emptyBody: 'Adjust the filters, or add the first product.',
    // product detail
    backToInventory: 'Back to inventory',
    locations: 'Locations',
    noStock: 'No stock recorded yet',
    noStockBody: 'Receive stock to place this product in a compartment.',
    defaultReturnable: 'Returnable by default',
    consumable: 'Consumable by default',
    archived: 'Archived',
    notTracked: 'Not tracked',
    notTrackedHint:
      'This category is not tracked, so the product is catalogue-only and holds no stock.',
    recentMovements: 'Recent movements',
    noMovements: 'No movements recorded yet',
    // stock actions
    receiveStock: 'Receive stock',
    moveStock: 'Move stock',
    adjustStock: 'Adjust stock',
    compartment: 'Compartment',
    fromCompartment: 'From',
    toCompartment: 'To',
    chooseCompartment: 'Choose a compartment…',
    quantity: 'Quantity',
    maxMovable: 'Most you can move',
    nothingToMove: 'There is no unreserved stock to move.',
    reservedExcluded: '{n} unit(s) are reserved for a pending request and cannot be moved.',
    adjustment: 'Adjustment',
    adjustmentHint: 'Positive adds stock, negative removes it.',
    reason: 'Reason',
    reasonHint: 'Recorded permanently in the ledger. Say what was counted and why it differs.',
    stockReceived: 'Stock received.',
    stockMoved: 'Stock moved.',
    stockAdjusted: 'Stock adjusted.',
    productCreated: 'Product created.',
    productUpdated: 'Product updated.',
    // movement types
    movement: {
      RECEIPT: 'Received',
      MOVE: 'Moved',
      ISSUE: 'Issued',
      RETURN: 'Returned',
      ADJUST: 'Adjusted',
      DISPOSE: 'Disposed',
    },
  },

  funds: {
    title: 'Money and purchasing',
    subtitle: 'Where this requisition has got to after the BOM.',
    // Single back arrow that walks backwards through the IM lifecycle. No free-form
    // stage selector — the lifecycle is strictly ordered and the server refuses
    // anything out of turn, so a pill selector would let the user reach for a
    // forbidden state.
    back: 'Back',
    // summary figures
    approved: 'Approved',
    funded: 'Funded',
    spent: 'Spent',
    transportation: 'Transportation',
    returned: 'Returned to Accounts',
    outstanding: 'Still to come',
    unspent: 'Unspent',
    // Shown next to unspent when transportation was folded into spent at verify-purchase.
    transportationNote: 'already spent on transportation',
    // actions, in the order they happen
    sendToAccounts: 'Send to Accounts',
    sendToAccountsHint: 'Records that the BOM has left your desk. Nothing is emailed.',
    recordReceipt: 'Record money received',
    recordPurchase: 'Record a purchase',
    attachInvoice: 'Attach invoice',
    replaceInvoice: 'Replace invoice',
    downloadInvoice: 'Download invoice',
    // The invoice block inside the verify form. Verification is refused without them, so this is
    // where they belong rather than in the panel list the IM had to go back to.
    invoices: 'Invoices',
    invoiceOnFile: 'Invoice attached',
    verifyPurchase: 'Verify purchase',
    unverifyPurchase: 'Back to purchased',
    unverifyPurchaseHint:
      'Returns this requisition to "Purchased" so the invoice and purchase rows can be re-recorded.',
    unverifyReason: 'Why are you un-verifying?',
    purchaseUnverified: 'Purchase un-verified',
    /*
     * Phase 08 — the rest of the way back. Every title names the stage being returned *to*, and
     * every hint names the exact entry being undone, because "Back" one row above a list of three
     * receipts does not say which of them is about to disappear.
     */
    undoSendToAccounts: 'Back to BOM',
    undoSendToAccountsHint:
      'Takes this requisition off the Accounts queue and returns it to "BOM generated". Only possible while no money has arrived.',
    undoSendReason: 'Why are you taking it back?',
    sendToAccountsUndone: 'Taken back from Accounts',
    voidReceipt: 'Undo money received',
    voidReceiptHint:
      'Voids {amount} received on {when}. The entry is kept and marked, not deleted, and the funded total drops by that much.',
    voidReceiptReason: 'Why is this receipt being voided?',
    receiptVoided: 'Receipt voided',
    voidPurchase: 'Undo purchase',
    voidPurchaseHint:
      'Voids the {amount} purchase from {vendor}. The entry is kept and marked, not deleted. Anything already added to inventory blocks this.',
    voidPurchaseReason: 'Why is this purchase being voided?',
    purchaseVoided: 'Purchase voided',
    /** Shown in place of Back at the two stages that cannot be undone. */
    noWayBack: 'Added to inventory. This cannot be undone here.',
    receiveToStock: 'Add to inventory',
    borrowToUser: 'Issue to a user',
    // fields
    amount: 'Amount',
    receivedAt: 'Date received',
    reference: 'Reference',
    referenceHint: 'Cheque number, transfer id — whatever Accounts gave you.',
    vendor: 'Vendor',
    invoiceNo: 'Invoice number',
    purchasedAt: 'Date purchased',
    unitCost: 'Unit cost',
    unitCostPositive: 'Enter a unit cost greater than zero.',
    // The ceiling is what has been funded, not what was approved: you cannot spend cash you
    // have not received (Ayman, 2026-08-31).
    overspendBlocked: 'This would commit {committed} against {funded} funded. Lower a unit cost, or record a further fund receipt first.',
    plannedQuantity: 'Planned: {n}',
    lineTotal: 'Line total',
    transportationActual: 'Transportation for this delivery',
    transportationActualHint: 'What the carriage actually cost. Adjust it up or down; it counts towards what has been funded.',
    purchaseTotal: 'This purchase',
    fundedLabel: 'Funded',
    leftToSpend: 'Left to spend',
    overspendInline: 'This is more than has been funded. Lower a quantity, a unit cost or the transportation until it is not negative.',
    quantity: 'Quantity',
    returnedAmount: 'Amount going back to Accounts',
    returnedAmountHint: 'Prefilled with the unspent balance. Set it to zero if nothing is going back.',
    returnNote: 'Why is it going back?',
    compartment: 'Compartment',
    borrower: 'Issue to',
    expectedReturnDate: 'Expected back',
    resolveProductTitle: 'Which product is this?',
    resolveProductHint:
      'Nobody picked this from the catalogue when the requisition was raised, so say what it is now. Choosing an item we already stock adds these units to it, wherever they are shelved.',
    useExistingProduct: 'It is a product we already stock',
    createNewProduct: 'It is a new product',
    existingProduct: 'Product',
    newProductTitle: 'This item is not in the catalogue yet',
    newProductHint: 'Receiving it creates the product, so it becomes searchable and borrowable.',
    productCode: 'Storage ID',
    productName: 'Product name',
    category: 'Category',
    unit: 'Unit',
    // states
    noPurchases: 'No purchases recorded yet.',
    receipts: 'Receipts',
    purchases: 'Purchases',
    returns: 'Returned',
    invoiceMissing: 'No invoice attached',
    lineOutstanding: (n: number) => `${n} still to receive`,
    lineDone: 'Fully received',
    // toasts
    sentToAccounts: 'Marked as sent to Accounts.',
    receiptRecorded: 'Receipt recorded.',
    // D-025: the amount input now states the cap it is enforcing, so an over-payment is caught
    // before submit rather than by a toast afterwards.
    outstandingHint: 'Still outstanding on this requisition:',
    purchaseRecorded: 'Purchase recorded.',
    invoiceAttached: 'Invoice attached.',
    purchaseVerified: 'Purchase verified.',
    stocked: 'Added to inventory.',
    issued: 'Issued to the user.',
    nothingToDo: 'Nothing to do here yet — this requisition has not reached the BOM stage.',
    done: 'This requisition is complete.',
  },

  expenses: {
    title: 'Expenses',
    subtitle: 'What has been requested, approved, funded and spent. Figures always reconcile.',
    groupBy: 'Group by',
    groupByMonth: 'Month',
    groupByDepartment: 'Department',
    groupByProject: 'Project',
    from: 'From',
    to: 'To',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    thisYear: 'This year',
    allTime: 'All time',
    clear: 'Clear',
    // Column headers, in the order money actually moves.
    bucket: 'Period',
    count: 'Requisitions',
    requested: 'Requested',
    approved: 'Approved',
    funded: 'Funded',
    spent: 'Spent',
    /**
     * The two halves of `Spent`. Transportation has no invoice behind it — it buys carriage, not
     * stock — so somebody reconciling `Spent` against a pile of purchase invoices would be short
     * by exactly the carriage with nowhere on the page to find it. Ayman reported precisely that
     * on 2026-08-26, on a 1,000 requisition of which 500 was a van.
     */
    spentOnPurchases: 'On purchases',
    spentOnTransportation: 'On transportation',
    returned: 'Returned',
    /**
     * `Net cash` is funded minus returned — what actually left the bank account. With
     * transportation now inside `Spent`, the two agree once a requisition has settled, which is
     * the check a reader should be able to do in their head.
     */
    netCash: 'Net cash',
    total: 'Total',
    downloadCsv: 'Download CSV',
    downloadPdf: 'Download PDF',
    emptyTitle: 'Nothing in this range',
    emptyBody: 'No submitted requisitions fall inside these dates.',
    netHint: 'Funded minus what went back to Accounts — what the company is actually out of pocket.',
    attributionHint:
      'Requested and approved are counted by submission date; funded, spent and returned by the date the money moved.',
  },

  account: {
    changePassword: 'Change your password',
  },

  signature: {
    title: 'Signature',
    subtitle:
      'Used on BOMs when you approve with your signature. Approvals you have already signed keep the signature they were signed with, even if you replace it here.',
    none: 'No signature uploaded yet.',
    upload: 'Upload signature',
    replace: 'Replace signature',
    remove: 'Remove',
    uploadedOn: (when: string) => `Uploaded ${when}`,
    accepted: 'PNG or JPEG, up to 2 MB.',
    uploaded: 'Signature saved',
    removed: 'Signature removed',
    preview: 'Your signature',
  },
  notifications: {
    title: 'Notifications',
    open: 'Open notifications',
    /** Screen-reader text for the badge; the visible badge is just the number. */
    unreadLabel: (count: number) => `${count} unread notification${count === 1 ? '' : 's'}`,
    markAllRead: 'Mark all as read',
    empty: 'Nothing yet',
    emptyHint: 'Approvals, returns and BOM activity will show up here.',
    viewAll: 'See all notifications',
    /** Shown on the badge when the real number would not fit. */
    overflow: '9+',
    unreadOnly: 'Unread only',
    loadError: 'Could not load notifications',
    retry: 'Try again',
  },
  auditLog: {
    title: 'Audit log',
    subtitle: 'Every state-changing action, who did it, and from where.',
    live: 'Live',
    refresh: 'Refresh',
    columns: {
      timestamp: 'When',
      actor: 'Actor',
      action: 'Action',
      entity: 'Entity',
      summary: 'Summary',
      outcome: 'Outcome',
      ip: 'IP',
      details: '',
    },
    filters: {
      title: 'Filters',
      from: 'From',
      to: 'To',
      actor: 'User',
      anyUser: 'All users',
      decision: 'Approvals',
      decisionApproved: 'Approved only',
      decisionRejected: 'Rejected only',
      any: 'Any',
      clear: 'Clear filters',
      activeFilters: (count: number) => `${count} filter${count === 1 ? '' : 's'} active`,
    },
    outcomes: {
      success: 'Success',
      failure: 'Failure',
      denied: 'Denied',
      error: 'Error',
    },
    actors: {
      system: 'System',
      unknown: 'Unknown actor',
      unknownEmail: 'Unknown email',
    },
    newActivity: 'New activity available',
    returnToLatest: 'Return to latest',
    emptyTitle: 'No audit entries yet',
    emptyBody: 'As admins perform actions, they will appear here within seven seconds.',
    details: {
      title: 'Audit entry',
      actor: 'Actor',
      roles: 'Roles',
      request: 'Request',
      method: 'Method',
      path: 'Path',
      ip: 'IP',
      userAgent: 'User agent',
      errorCode: 'Error code',
      metadata: 'Metadata',
      changes: 'Changes',
      value: 'Value',
      noMetadata: 'No additional metadata recorded.',
      closedAt: 'Logged at',
    },
    pagination: {
      page: (page: number) => `Page ${page}`,
      of: 'of',
    },
  },

  categories: {
    title: 'Categories',
    subtitle: 'Group products, and choose which of them the system tracks stock for.',
    newCategory: 'New category',
    editCategory: 'Edit category',
    name: 'Name',
    parent: 'Parent category',
    noParent: 'Top level',
    trackable: 'Track stock for this category',
    trackableHint:
      'Untracked categories stay in the catalogue for reference but hold no stock — furniture, for example.',
    products: 'Products',
    created: 'Category created.',
    updated: 'Category updated.',
    emptyTitle: 'No categories yet',
    emptyBody: 'Create one before adding products.',
  },

  locations: {
    title: 'Locations',
    subtitle: 'Zones hold compartments. A product’s stock lives in a compartment.',
    newZone: 'New zone',
    editZone: 'Edit zone',
    newCompartment: 'New compartment',
    editCompartment: 'Edit compartment',
    zone: 'Zone',
    zoneName: 'Zone name',
    compartmentCode: 'Compartment code',
    compartments: 'Compartments',
    holdingStock: 'holding stock',
    zoneCreated: 'Zone created.',
    zoneUpdated: 'Zone updated.',
    compartmentCreated: 'Compartment created.',
    compartmentUpdated: 'Compartment updated.',
    emptyTitle: 'No zones yet',
    emptyBody: 'Create a zone, then add compartments to it.',
    noCompartments: 'No compartments in this zone yet.',
  },

  borrowing: {
    title: 'Borrowing',
    subtitle: 'Requests to take stock out, and what is still outstanding.',
    myTitle: 'My borrowings',
    mySubtitle: 'What you have asked for, and what you still have out.',
    borrow: 'Borrow',
    borrowNo: 'Reference',
    borrower: 'Taken by',
    product: 'Product',
    project: 'Project',
    noProject: 'No project',
    newProject: 'New project…',
    projectName: 'Project name',
    quantity: 'Quantity',
    outstanding: 'Still out',
    location: 'From',
    returnTo: 'Return to',
    takenOn: 'Taken',
    expectedReturn: 'Expected back',
    returnedOn: 'Returned',
    purpose: 'Purpose',
    purposeHint: 'What it is for. Helps the Inventory Manager decide quickly.',
    returnable: 'I will return this',
    returnableHint: 'Untick for a consumable — something used up and never returned.',
    consumable: 'Consumable',
    searchPlaceholder: 'Search by product, reference or borrower',
    // actions
    approve: 'Approve',
    reject: 'Reject',
    recordReturn: 'Record return',
    revert: 'Revert to pending',
    revertReason: 'Why is this being reverted?',
    cancel: 'Cancel request',
    decisionNote: 'Note',
    returnCondition: 'Return condition',
    conditionGood: 'Good',
    conditionPartiallyDamagedUsable: 'Partially damaged but usable',
    conditionDamaged: 'Damaged',
    conditionNotWorking: 'Not working',
    /**
     * The DAMAGED / NOT_WORKING choice goes hand-in-hand with a note in the admin feed; this
     * hint makes the consequence visible without hovering over the dropdown.
     */
    returnConditionHint:
      'Damaged / Not-working units are quarantined and excluded from available stock.',
    // results
    requested: 'Request submitted. The Inventory Manager will review it.',
    approved: 'Approved and issued.',
    rejected: 'Rejected. The reservation has been released.',
    returned: 'Return recorded.',
    reverted: 'Reverted to pending.',
    cancelled: 'Request cancelled.',
    // filters
    filterAll: 'All',
    filterPending: 'Pending',
    filterOut: 'Out',
    filterReturned: 'Returned',
    filterOverdue: 'Overdue',
    overdue: 'Overdue',
    emptyTitle: 'Nothing to show',
    emptyBody: 'No borrow requests match this filter.',
    myEmptyTitle: 'You have not borrowed anything yet',
    myEmptyBody: 'Find a product in the inventory and press Borrow.',
    outstandingHint: 'You can return part of a borrow; the rest stays out.',
    /**
     * "Currently in use" section on the product detail page. One row per active borrow, ordered
     * most-recently-issued first; "returned X of Y" lets a partial return show clearly.
     */
    currentlyInUse: 'Currently in use',
    currentlyInUseEmpty: 'Nothing is currently in use.',
    borrowedBy: 'Borrowed by',
    lastReturnCondition: 'Most recent return',
    conditionLabels: {
      GOOD: 'Good',
      PARTIALLY_DAMAGED_USABLE: 'Partially damaged but usable',
      DAMAGED: 'Damaged',
      NOT_WORKING: 'Not working',
    },
    /**
     * Quarantine lifecycle for placements shown next to product totals. The chip carries the
     * count; the buttons here only render when quarantined_qty > 0 because releasing or
     * disposing nothing is a no-op the API would reject.
     */
    quarantineTitle: 'Quarantined stock',
    quarantineRelease: 'Release (verified usable)',
    quarantineDispose: 'Dispose (write off)',
    quarantineDialogTitle: 'Quarantine action',
    quarantineQuantityLabel: 'Units',
    quarantineQuantityHint: 'Cannot exceed the quarantined quantity on this placement.',
    quarantineNoteLabel: 'Note',
    quarantineNoteHint:
      'Required — describe what you did with the damaged units, so a future audit reader knows.',
    quarantineReleasedToast: 'Quarantined units released back to available.',
    quarantineDisposedToast: 'Quarantined units written off.',
    status: {
      PENDING: 'Pending',
      REJECTED: 'Rejected',
      ISSUED: 'Out',
      PARTIALLY_RETURNED: 'Partly returned',
      RETURNED: 'Returned',
      CANCELLED: 'Cancelled',
    },
  },

  projects: {
    title: 'Projects',
    subtitle: 'What each project has borrowed, and what it has asked for.',
    create: 'New project',
    created: 'Project created',
    nameLabel: 'Project name',
    createdOn: (when: string) => `Created ${when}`,
    empty: 'No projects yet.',
    emptyBody: 'Create one here, or from the borrow dialog when you take something out.',
    duplicateTitle: 'A project with that name already exists',
    duplicateBody: 'Two teams can run projects with the same name. Continue anyway?',
    createAnyway: 'Create anyway',
    itemsHeading: 'Items in hand',
    itemsHint: 'Added automatically when someone borrows for this project.',
    itemsEmpty: 'Nothing borrowed for this project yet.',
    requestedHeading: 'Requested',
    requestedHint: 'Requisitions charged to this project.',
    requestedEmpty: 'No requisitions for this project.',
    filterAll: 'All',
    filterInUse: 'In use',
    filterReturned: 'Returned',
    tagInUse: 'In use',
    tagReturned: 'Returned',
    borrowedBy: 'Borrowed by',
    remove: 'Remove',
    removed: 'Removed from this project',
    removeHint: 'Removes it from this project. The borrowing record itself is kept.',
    outstanding: (out: number, total: number) => `${out} of ${total} still out`,
    counts: (inUse: number, returned: number) => `${inUse} in use · ${returned} returned`,
  },

  requisitions: {
    title: 'Requisitions',
    subtitle: 'Ask for something to be bought, and follow it through approval.',
    myTitle: 'My requisitions',
    mySubtitle: 'What you have asked for, and where each request has got to.',
    approvalsTitle: 'Approvals',
    approvalsSubtitle: 'Requests waiting on you, and the ones you have already decided.',
    newRequisition: 'New requisition',
    editDraft: 'Edit draft',
    requisitionNo: 'Reference',
    requester: 'Raised by',
    // header zone (requirements §3)
    detailsHeading: 'Request details',
    detailsHint: 'These apply to the whole request.',
    department: 'Department',
    project: 'Project',
    /**
     * Ayman's ruling, 2026-08-26: a requisition with no project is personal development, which
     * is an answer rather than a blank. Project therefore stays optional (D-006) while the label
     * stops reading like something the requester forgot to fill in. It is a label over a null
     * project_id, not a seeded Project row, so nothing is migrated and reporting keeps one
     * bucket to group on.
     */
    noProject: 'Personal development',
    urgency: 'Urgency',
    approvalDeadline: 'Approval deadline',
    approvalDeadlineHint:
      'Approvers are reminded once this passes, so a date already gone would chase them the moment you submit. Pick today or later.',
    setDeadline: 'Set deadline',
    timeLabel: 'Time',
    hourLabel: 'Hour',
    minuteLabel: 'Minute',
    meridiemLabel: 'AM or PM',
    summaryHeading: 'Summary',
    approverCountOne: '1 approver',
    approverCountOther: '{n} approvers',
    // Two halves of one sentence; the count is prepended by the component so it can be bolded.
    // 'at or above', never 'over' -- the boundary is inclusive (OQ-01), so a requisition for
    // exactly the threshold needs the higher count.
    approverNoteBelow:
      'needed at this amount. At or above {threshold} it becomes {higher}, so a larger request takes longer to clear.',
    approverNoteAtOrAbove:
      'needed. This is at or above the {threshold} threshold, so expect a second sign-off before anything is bought.',
    reasonCounter: '{n}/{max}',
    selectDate: 'Select date & time',
    // UX-6: the facts an approver decides on, labelled rather than left as a grey subtitle.
    raisedBy: 'Raised by',
    // Not 'Submitted': the lifecycle tracker already uses that word for the stage, and a
    // date labelled the same as a stage reads as the stage on a page that shows both.
    submittedOn: 'Submitted on',
    neededBy: 'Needed by',
    reason: 'Reason',
    reasonHint: 'Why this is needed. The approvers read this first.',
    // items zone
    itemsHeading: 'Items',
    itemsHint: 'One line per thing you need.',
    addItem: 'Add item',
    removeItem: 'Remove',
    itemName: 'Item',
    itemNameHint: 'Pick from the catalogue, or type anything we do not stock yet.',
    itemNamePlaceholder: 'Search the catalogue, or type a new item',
    outOfStock: 'None in stock',
    linkedOutOfStock: 'In the catalogue. None in stock right now.',
    noCatalogueMatch: 'Nothing in the catalogue matches. It will be requested as a new item.',
    // The duplicate guard: one product typed three ways is three products in every report.
    didYouMean: 'Did you mean {name}? Click to use the catalogue entry.',
    quantity: 'Quantity',
    unitPrice: 'Unit price (BDT)',
    lineTotal: 'Line total',
    inStockHint: '{n} already in stock',
    inStockAdvisory: 'Advisory only — you can still request more.',
    fromCatalogue: 'From the catalogue',
    freeText: 'Not in the catalogue',
    // Shown when `GET /products` fails. Without it the picker is simply empty and the requester
    // types free text, unaware every line will reach the approvers unlinked from stock (D-002).
    catalogueUnavailable:
      'The item catalogue could not be loaded, so the picker is empty. You can still type item names, but they will not be linked to a stocked product.',
    // detail page only — the items table subheading inside the merged stats+items card.
    // The form-page itemsHeading is for the editor; this is for the read-only view.
    lineItemsHeading: 'Line items',
    // Field labels for the unlabelled grey text. Adds clarity to "why this requisition" and
    // the transportation breakdown without a heavy redesign.
    transportationDescriptionLabel: 'Description',
    // money
    requested: 'Requested',
    // The column is seeded with the requested figure at submit so the BOM has a number to
    // print, but the screen does not show it until an approver has actually decided — a
    // figure captioned "approved" before anyone approved is a claim the record cannot support
    // (UX-5). The detail page renders an em dash until then; this label is for after.
    approvedAmount: 'Approved amount',
    // A draft has no frozen figure yet, so what is shown is the sum of the lines below and
    // must say so — the alternative was rendering a hard 0 above a costed table (D-016).
    requestedHintDraft: 'Provisional — fixed when you submit.',
    // QA-009: a draft has no frozen amount, and the list rendered `?? 0` — a hard 0 beside
    // rows showing real money reads as 'this costs nothing', not 'this is not fixed yet'.
    provisionalTag: 'provisional',
    // QA-008: the toast named all three required fields whether or not they were missing,
    // because one string cannot know which failed. The fields carry the answer now; the toast
    // only points at them.
    fieldRequired: 'Required.',
    fixHighlighted: 'Fill in the highlighted fields before submitting.',
    approvedAmountHintRevised: 'An approver revised this down from the requested amount.',
    total: 'Total',
    thresholdNote: 'Threshold at submit',
    approverCount: 'Approvers required',
    // actions
    saveDraft: 'Save draft',
    submit: 'Submit for approval',
    submitHint: 'Once submitted the amounts and the approver list are fixed.',
    cancelRequest: 'Cancel request',
    // The template's inline decision card. `approve` / `reject` below label its buttons.
    yourDecision: 'Your decision',
    yourDecisionHint: 'Approving moves this requisition to the next approver in the chain.',
    decisionNoteOptional: 'Optional — the requester and the next approver both see it.',
    itemsSubtotalLabel: 'Items subtotal',
    // The approver count moved into the progress rail, where it explains the chain beside it.
    approverCountHint: '{n} approvers required — threshold at submit was {threshold}.',
    // Revise sits behind a button, the way transportation does on the requisition form.
    reviseAmountOpen: 'Revise the approved amount',
    reviseAmountCancel: 'Cancel revision',
    approve: 'Approve',
    approveWithSignature: 'Approve with signature',
    approveWithoutSignature: 'Approve without signature',
    noSignatureHint: 'Upload a signature below to enable "Approve with signature".',
    noSignatureTitle: 'No signature on file',
    noSignatureBody:
      'Upload one now to enable signing this approval. PNG or JPEG; the same file is reused for every approval until you replace it.',
    uploadSignatureHere: 'Upload signature',
    removeSignature: 'Remove signature',
    signatureUploading: 'Uploading…',
    signatureUploadedInline: 'Signature saved. You can now approve with signature.',
    reject: 'Reject',
    withdraw: 'Withdraw approval',
    withdrawReason: 'Why are you withdrawing? (You can still approve or reject again afterwards.)',
    decisionNote: 'Note',
    reviseAmount: 'Revise the approved amount',
    reviseAmountHint: 'Leave blank to approve the full requested amount.',
    reviseAmountOptIn: 'Revise the approved amount',
    reviseAmountOptInHint: 'Tick to enter a different figure; leave unticked to approve the full requested amount.',
    // QA-034: one line, one unit — there is no smaller quantity to buy, so a lower figure
    // would approve an amount that cannot purchase the thing being asked for. Reject or
    // approve in full are the only honest options, and the screen says why.
    reviseAmountIndivisible: 'This is a single item, so the amount cannot be revised down — approve it in full or reject it.',
    // Was "...and it cannot be reopened", which stopped being true when withdraw shipped and
    // was telling people a rejection was final for months.
    rejectWarning:
      'Rejecting ends the whole request — the other approvers will not be asked. You can take your rejection back afterwards if you change your mind.',
    // results
    draftSaved: 'Draft saved.',
    // D-015: submitting is save-then-submit, so a refused submit still leaves a saved draft
    // holding a reference number. Saying nothing is how QA ended up with two orphan drafts.
    keptAsDraft: 'Your work was kept as a draft. Submit it again once the problem above is fixed.',
    submitted: 'Submitted. The Inventory Manager will review it first.',
    approvedToast: 'Approved.',
    rejectedToast: 'Rejected. The requester has been told.',
    withdrawnToast: 'Approval withdrawn.',
    cancelledToast: 'Requisition cancelled.',
    // tracker (task 3.6)
    trackerHeading: 'Progress',
    // Shown on a draft, where there is no chain yet. Says why rather than just that.
    trackerEmpty:
      'Not submitted yet. The approval chain is worked out when you submit, and appears here.',
    /*
     * The end of the chain is not the end of the job.
     *
     * Everybody has signed and the requisition now waits to be put on a BOM, so the tracker says
     * what happens next rather than stopping at a tick. "Generate" is the word on the button it
     * leads to, so the two read as one action.
     */
    generateBomNext: 'Generate the BOM for this requisition',
    seeWhy: 'See why',
    rejectedBy: 'Rejected by',
    approvedBy: 'Approved by',
    onBehalfOf: 'on behalf of',
    awaiting: 'Waiting on',
    notReached: 'Not reached yet',
    skipped: 'Skipped',
    history: 'History',
    // horizontal lifecycle tracker (full requisition lifecycle)
    lifecycleHeading: 'Lifecycle',
    lifecycleRejected: 'Rejected',
    lifecycleCancelled: 'Cancelled',
    lifecycleDoneAt: 'Completed {when}',
    lifecycleStages: {
      submitted: 'Submitted',
      imReview: 'IM review',
      approved: 'Approved',
      bom: 'BOM',
      accounts: 'Accounts',
      funded: 'Funded',
      purchased: 'Purchased',
      verified: 'Verified',
      inStock: 'In stock',
    },
    // filters
    filterAll: 'All',
    filterAwaitingMe: 'Waiting on me',
    filterDrafts: 'Drafts',
    filterApproved: 'Approved',
    filterRejected: 'Rejected',

    searchPlaceholder: 'Search by reference, requester or reason',
    // D-019: the list is ordered by updated_at DESC server-side, but no column shows that and
    // none of the headers is sortable, so an edited draft appeared to jump the queue for no
    // reason. Stating the order is the honest fix; sortable headers would be a new feature.
    sortNote: 'Sorted by last updated, newest first.',
    emptyTitle: 'Nothing to show',
    emptyBody: 'No requisitions match this filter.',
    myEmptyTitle: 'You have not raised a requisition yet',
    myEmptyBody: 'Start one when you need something bought.',
    approvalsEmptyTitle: 'Nothing is waiting on you',
    approvalsEmptyBody: 'Requests appear here when it is your turn to decide.',
    // delegation (task 3.5)
    delegationTitle: 'Delegate my approvals',
    delegationSubtitle:
      'Hand your approvals to another approver for a period — while you are away, for example.',
    delegateTo: 'Delegate to',
    delegationFrom: 'From',
    delegationTo: 'Until',
    delegationActive: 'Active now',
    delegationScheduled: 'Scheduled',
    delegationExpired: 'Expired',
    addDelegation: 'Add delegation',
    revokeDelegation: 'Revoke',
    delegationCreated: 'Delegation created.',
    delegationRevoked: 'Delegation revoked.',
    delegationEmpty: 'You have not delegated your approvals.',
    status: {
      DRAFT: 'Draft',
      IM_REVIEW: 'With the Inventory Manager',
      AWAITING_APPROVAL: 'Awaiting approval',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      BOM_GENERATED: 'BOM generated',
      SENT_TO_ACCOUNTS: 'Sent to Accounts',
      FUNDS_PARTIAL: 'Partly funded',
      FUNDS_RECEIVED: 'Funded',
      PURCHASED: 'Purchased',
      PURCHASE_VERIFIED: 'Purchase verified',
      STOCKED: 'Stocked',
      CLOSED: 'Closed',
      CANCELLED: 'Cancelled',
    },
    urgencyLabel: {
      LOW: 'Low',
      NORMAL: 'Normal',
      HIGH: 'High',
      CRITICAL: 'Critical',
    },
    /**
     * Two tags the IM can stamp on a DRAFT requisition via the BOM generate page's
     * "Send back for revision" flow. The `draftForRevise` tag appears next to the DRAFT
     * pill while the requisition sits waiting for the requester; `draftRevised` appears
     * once the requester has re-submitted, so the IM can see the chain has been
     * replayed. Both are derived from the events log on the server — no new status enum.
     */
    statusTags: {
      draftForRevise: 'For revise',
      draftRevised: 'Revised',
      draftForReviseHint: 'Sent back for budget revision. Edit the items and re-submit.',
      draftRevisedHint: 'Re-submitted after a send-back. Approvers will see a fresh chain.',
    },
    stage: {
      INVENTORY_MANAGER: 'Inventory Manager',
      APPROVER: 'Approver',
    },
    // supporting document (request details panel + paper thumbnail)
    supportingDocument: {
      fieldHeading: 'Supporting document',
      fieldHint:
        'Optional. A quote, vendor proposal or spec sheet that helps your approvers decide.',
      empty: 'No document attached yet.',
      pickerCta: 'Attach document',
      replace: 'Replace',
      remove: 'Remove',
      tooLarge: 'That file is too large. Maximum size is 5 MB.',
      uploadFailed: 'Upload failed. Try again.',
    },
    supportingDocumentCard: {
      label: 'Supporting document',
      openFailed: 'Could not open the document. Try again.',
    },
    // transportation cost (request details + BOM footer)
    transportation: {
      heading: 'Transportation cost',
      hint:
        'Optional. Add the cost of getting to the market — fuel, vehicle hire, porter, etc. Rolls up into the requested amount.',
      amount: 'Amount (BDT)',
      description: 'Description',
      descriptionPlaceholder: 'e.g. Pickup truck to Gazipur (optional)',
      missingDescription: 'Add a short description so approvers know what this covers.',
      detailHeading: 'Transportation',
      none: 'No transportation cost.',
      itemsTotal: 'Items total',
      transportationTotal: 'Transportation',
      requested: 'Requested amount',
    },
  },

  boms: {
    title: 'Bills of Materials',
    // Column header on the per-source line table. Was a bare 'Purpose' literal in JSX, which
    // rules/30-frontend.md bans -- copy lives here so a wording change is one file.
    purpose: 'Purpose',
    subtitle: 'Group approved requisitions into a payable document for Accounts.',
    newBom: 'New BOM',

    // list
    bomNo: 'BOM number',
    sources: 'Sources',
    openRequisition: 'Open the requisition',
    openRequisitionBlocked: 'Render the PDF first — Accounts is sent the document, so it has to exist before the requisition goes to them.',
    noSources: '—',
    generatedAt: 'Generated',
    generatedBy: 'By',
    pdfStatus: 'PDF',
    pdfReady: 'PDF on file',
    pdfPending: 'PDF pending',
    voidedLabel: 'Voided',

    // detail
    approvedTotal: 'Approved total',
    itemsSubtotal: 'Items subtotal',
    transportation: 'Transportation',
    bomSubtotal: 'BOM subtotal',
    totalAmount: 'Total amount',
    variance: 'Variance',
    // QA-019: the builder compared items-only against an approved figure that includes the
    // carriage, so every requisition with transportation showed a phantom variance of exactly
    // the van. The carriage is now its own line and the total counts it.
    bomTransportation: 'Transportation',
    bomCommitted: 'BOM total',
    overspentHeading: 'This BOM commits more than was approved',
    overspentLine: '{no}: {committed} committed against {approved} approved — {over} over.',
    overspentHint: 'Lower a quantity or a unit cost until it fits. Transportation counts towards the approved amount.',
    voidBanner: 'Voided',
    voidedAt: 'Voided at',
    voidedBy: 'By',
    bouncedBanner: 'Bounced — over the tolerance',

    // generate
    pickRequisitions: 'Pick approved requisitions',
    pickRequisitionsHint:
      'Tick the requisitions to batch. Their lines appear below; you only fill unit cost and vendor.',
    emptyCandidatesTitle: 'Nothing is ready to batch',
    emptyCandidatesBody:
      'Approved requisitions appear here as soon as approvers sign off.',
    lineEditorHeading: 'Lines',
    lineEditorHint:
      'The numbers you type here become the BOM total and the PDF Accounts files.',
    unitCost: 'Unit cost (BDT)',
    vendor: 'Vendor',
    lineTotal: 'Line total',
    lineQuantityLabel: 'Qty',
    lineSourceQuantityHint: 'Originally {qty} on the requisition',
    removeLineLabel: 'Drop from BOM',
    bounceWarning:
      'This BOM will bounce — its sources will return to the approver queue.',
    generate: 'Generate BOM',
    generatedToast: 'BOM created.',
    approved: 'Approved',
    // Single-item + over-budget branch — IM bounces the requisition to the requester
    // for budget revision rather than generating a BOM that cannot be approved.
    sendBackForRevision: 'Send back for revision',
    sendBackHint:
      'A single-line BOM cannot shrink to fit. Bounce this requisition back to the requester — they edit the budget, re-submit, and the approval chain replays.',
    sendBackDialog: {
      title: 'Send requisition back for revision',
      body:
        'The requisition will go back to the requester as a draft. They edit the budget and re-submit — you will get a fresh approval row to decide.',
      reasonLabel: 'Reason',
      reasonHint: 'Recorded on the audit log and shown to the requester.',
      confirm: 'Send back',
      successToast: 'Requisition sent back for revision.',
    },

    // render
    render: 'Render PDF',
    reRender: 'Re-render PDF',
    renderToast: 'PDF cached.',
    downloadPdf: 'Download PDF',

    // void
    void: 'Void BOM',
    voidTitle: 'Void this BOM?',
    voidHint:
      'Voiding frees its source requisitions so they can be re-batched. The cached PDF is removed.',
    voidReason: 'Reason',
    voidReasonHint: 'Recorded in the audit trail. Aim for one short sentence.',
    voidConfirm: 'Void',
    voidedToast: 'BOM voided.',

    // filters
    filterAll: 'All',
    filterLive: 'Live',
    filterVoided: 'Voided',
    searchPlaceholder: 'Search by BOM number',
    emptyTitle: 'No BOMs match this filter',
    emptyBody: 'Pick approved requisitions to create the first BOM.',

    // history / approvals
    historyHeading: 'History',
    approvalChainHeading: 'Approval chain (frozen at generation)',
  },

  errors: {
    VALIDATION_FAILED: 'Some of those values are not valid. Check them and try again.',
    BORROW_INVALID_TRANSITION: 'That is no longer possible for this request. Refresh to see why.',
    BORROW_ALREADY_DECIDED: 'Someone already acted on this. Refresh to see the outcome.',
    DUPLICATE_PROJECT_NAME: 'A project with that name already exists.',
    REQUISITION_INVALID_TRANSITION:
      'That is no longer possible for this requisition. Refresh to see its current stage.',
    APPROVAL_ALREADY_ACTED: 'Someone already acted on this approval. Refresh to see the outcome.',
    // The server names the missing fields in details.missing; the form marks them. This is the
    // fallback for anywhere that shows the bare message. Drafts are unaffected by design.
    APPROVAL_DEADLINE_IN_PAST:
      'That approval deadline has already passed. Pick today or a later date, then submit again.',
    REQUISITION_INCOMPLETE:
      'Department, approval deadline and reason are needed before this can be submitted. Your draft has been kept.',
    NOT_YOUR_APPROVAL: 'That approval is not assigned to you.',
    APPROVER_SLOT_UNASSIGNED:
      'An approver slot has not been assigned yet. An administrator must set it in Settings → Approver slots before this can be submitted.',
    // Names the setting that is actually missing. Requisitions below the expense threshold do
    // not use the approver slots, so pointing at that screen sent admins somewhere already correct.
    SUBTHRESHOLD_APPROVER_UNASSIGNED:
      'No approver is set for requests below the expense threshold. An administrator must choose one in Settings → Sub-threshold approver. (Approver 1 and 2 do not apply below the threshold.)',
    // Nobody approves their own requisition, so an approver raising one needs someone to stand in.
    PAYLOAD_TOO_LARGE: 'That file is too large. Choose a smaller one and try again.',
    SELF_APPROVAL_FORBIDDEN:
      'You cannot approve your own requisition. Another approver has to act on this one.',
    SELF_APPROVAL_NO_SUBSTITUTE:
      'You are the approver for this requisition, and nobody is configured to approve it in your place. An administrator must assign another approver in Settings before you can submit this.',
    UNAUTHENTICATED: 'Please sign in.',
    INVALID_CREDENTIALS: 'Email or password is incorrect.',
    TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
    TOKEN_REUSE_DETECTED: 'Your session was revoked for security reasons. Please sign in again.',
    SESSION_REVOKED: 'An administrator ended your session. Please sign in again.',
    FORBIDDEN: 'You do not have permission to do that.',
    NOT_FOUND: 'That item no longer exists.',
    CONFLICT: 'That change conflicts with the current state.',
    ACCOUNT_DEACTIVATED: 'This account has been deactivated.',
    RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
    UNKNOWN_SETTING: 'That setting does not exist.',
    INSUFFICIENT_STOCK: 'There is not enough stock in that compartment.',
    INSUFFICIENT_STOCK_QUARANTINED:
      'Only {available} are available at this location — {quarantined} are in quarantine.',
    STOCK_VERSION_CONFLICT:
      'This stock changed while the screen was open. The figures have been refreshed — check them and try again.',
    CATEGORY_NOT_TRACKABLE: 'That category does not track stock, so it cannot hold quantities.',
    STOCK_RESERVED: 'Those units are reserved for a pending borrow and cannot be moved or removed.',
    BOM_OVER_BUDGET:
      'This BOM was over budget and bounced. Adjust the unit costs and try again.',
    // The screen names the offending requisition and the shortfall from details.overspent;
    // this is the fallback wherever only the bare message is shown.
    BOM_SPANS_MULTIPLE_REQUESTERS:
      'A BOM covers one requester. Un-tick the requisitions that belong to someone else and generate a separate BOM for them.',
    // The screen names the shortfall from details; this is the fallback wherever only the
    // bare message is shown.
    PURCHASE_EXCEEDS_FUNDED:
      'This purchase would spend more than has been funded. Lower a unit cost, or record a further fund receipt first.',
    BOM_EXCEEDS_APPROVED_AMOUNT:
      'This BOM commits more than was approved. Lower a quantity or a unit cost until it fits, or send the requisition back to be restated.',
    BOM_QUANTITY_EXCEEDS_SOURCE:
      'That quantity is more than the requisition asks for. Shrink it to {max} or less.',
    ALL_BOM_LINES_REMOVED:
      'A BOM needs at least one line. Add a line back, or cancel out of the picker.',
    CANNOT_SEND_BACK_FOR_REVISION:
      'This requisition cannot be sent back — either it is no longer approved, or it has more than one item.',
    BOM_REQUISITION_NOT_APPROVED:
      'One of the selected requisitions is no longer approved. Refresh and try again.',
    BOM_REQUISITION_ALREADY_ON_LIVE_BOM:
      'One of the selected requisitions is already on a live BOM.',
    BOM_ALREADY_ON_LIVE_BOM:
      'One of the selected requisitions is already on a live BOM.',
    BOM_ALREADY_VOID: 'This BOM has already been voided.',
    PDF_RENDER_FAILED: 'The PDF could not be rendered. Try again.',
    PDF_DOWNLOAD_TOKEN_INVALID: 'This download link has expired.',
    RETURN_EXCEEDS_UNSPENT:
      'Only {unspent} is unspent, so {attempted} cannot be returned to Accounts.',
    INVOICE_MISSING:
      '{purchasesWithoutInvoice} purchase(s) on this requisition still have no invoice attached. Upload them before verifying.',
    FUNDING_EXCEEDS_APPROVED:
      'Recording {attempted} would take the funding to {wouldBecome}, past the approved {approved}. Ask an approver to revise the amount first.',
    RECEIVE_EXCEEDS_PURCHASED:
      'Only {outstanding} of "{itemName}" is still outstanding, so {attempted} cannot be received.',
    CANNOT_UNVERIFY_WITH_RETURNS:
      'This requisition has {returnedAmount} returned to Accounts already. Un-verifying is not the right way to undo a refund — record a corrective return instead.',
    // Every reversal refusal names the step that has to be undone first. "You cannot do this" on
    // its own leaves the IM guessing, and the answer is always one specific earlier stage.
    CANNOT_UNDO_SEND_WITH_RECEIPTS:
      'Accounts has already released {funded} against this requisition. Void that receipt before taking it back off the Accounts queue.',
    CANNOT_VOID_RECEIPT_WITH_PURCHASES:
      '{purchaseCount} purchase(s) are recorded against this money. Void those first, then the receipt.',
    CANNOT_VOID_RECEIVED_PURCHASE:
      '{receivedQuantity} unit(s) from this purchase are already on a shelf, so it can no longer be voided. Correct the stock instead.',
    MONEY_ROW_NOT_FOUND:
      'That entry is not on this requisition, or somebody has already voided it. Reload the page to see where things stand.',
    SIGNATURE_NOT_UPLOADED:
      'You have not uploaded a signature yet. Add one from your profile, or approve without a signature.',
    APPROVED_EXCEEDS_REQUESTED:
      'You cannot approve more than the {requested} requested. Approve up to that, or send the requisition back so the requester can restate it.',
    DELEGATION_ALREADY_LIVE:
      'You already have a delegation covering part of that period. An approver can have only one delegate at a time — revoke the existing one first.',
    INTERNAL: 'Something went wrong on the server.',
    NETWORK: 'Cannot reach the server.',
  },
} as const;

export type Copy = typeof t;
