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
    allRequisitions: 'All requisitions',
    approvals: 'Approvals',
    expenses: 'Expenses',
    admin: 'Administration',
    adminUsers: 'Users',
    adminDepartments: 'Departments',
    adminSettings: 'Settings',
    adminAuditLog: 'Audit log',
    account: 'My account',
    inventoryProducts: 'Products',
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
      'Foundation is in place. Inventory, borrowing, requisitions and BOM arrive in later phases.',
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
    title: 'Inventory',
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
    // summary figures
    approved: 'Approved',
    funded: 'Funded',
    spent: 'Spent',
    returned: 'Returned to Accounts',
    outstanding: 'Still to come',
    unspent: 'Unspent',
    // actions, in the order they happen
    sendToAccounts: 'Send to Accounts',
    sendToAccountsHint: 'Records that the BOM has left your desk. Nothing is emailed.',
    recordReceipt: 'Record money received',
    recordPurchase: 'Record a purchase',
    attachInvoice: 'Attach invoice',
    replaceInvoice: 'Replace invoice',
    downloadInvoice: 'Download invoice',
    verifyPurchase: 'Verify purchase',
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
    quantity: 'Quantity',
    returnedAmount: 'Amount going back to Accounts',
    returnedAmountHint: 'Leave at zero if nothing is being returned.',
    returnNote: 'Why is it going back?',
    compartment: 'Compartment',
    borrower: 'Issue to',
    expectedReturnDate: 'Expected back',
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
    returned: 'Returned',
    /**
     * `Net cash` is funded minus returned — what actually left the bank account. It is *not*
     * the purchase expense (that is the `spent` column). The two columns are kept apart so a
     * reader never has to guess which one describes the goods.
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
    projectCreated: 'Project created.',
    duplicateProjectTitle: 'A project with that name already exists',
    duplicateProjectBody: 'Two teams can run projects with the same name. Continue anyway?',
    createAnyway: 'Create anyway',
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
    noProject: 'No project',
    urgency: 'Urgency',
    approvalDeadline: 'Approval deadline',
    approvalDeadlineHint: 'Approvers are reminded once this passes.',
    reason: 'Reason',
    reasonHint: 'Why this is needed. The approvers read this first.',
    // items zone
    itemsHeading: 'Items',
    itemsHint: 'One line per thing you need.',
    addItem: 'Add item',
    removeItem: 'Remove',
    itemName: 'Item',
    itemNameHint: 'Pick from the catalogue, or type anything we do not stock yet.',
    quantity: 'Quantity',
    unitPrice: 'Unit price (BDT)',
    lineTotal: 'Line total',
    inStockHint: '{n} already in stock',
    inStockAdvisory: 'Advisory only — you can still request more.',
    fromCatalogue: 'From the catalogue',
    freeText: 'Not in the catalogue',
    // money
    requested: 'Requested',
    // Pre-approval, this column is seeded with the requested figure so the BOM has a number
    // to print; an approver may revise it down. We label it "Sanctioned" so the UI does not
    // claim an approver signed off before one has.
    sanctioned: 'Sanctioned',
    sanctionedHintPending: 'Defaults to the requested amount; approvers may revise down.',
    sanctionedHintRevised: 'An approver revised this from the requested amount.',
    total: 'Total',
    thresholdNote: 'Threshold at submit',
    approverCount: 'Approvers required',
    // actions
    saveDraft: 'Save draft',
    submit: 'Submit for approval',
    submitHint: 'Once submitted the amounts and the approver list are fixed.',
    cancelRequest: 'Cancel request',
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
    reviseAmount: 'Revise the sanctioned amount',
    reviseAmountHint: 'Leave blank to approve the full requested amount.',
    reviseAmountOptIn: 'Revise the sanctioned amount',
    reviseAmountOptInHint: 'Tick to enter a different figure; leave unticked to approve the full requested amount.',
    rejectWarning:
      'Rejecting ends the whole request. The other approvers will not be asked, and it cannot be reopened.',
    // results
    draftSaved: 'Draft saved.',
    submitted: 'Submitted. The Inventory Manager will review it first.',
    approvedToast: 'Approved.',
    rejectedToast: 'Rejected. The requester has been told.',
    withdrawnToast: 'Approval withdrawn.',
    cancelledToast: 'Requisition cancelled.',
    // tracker (task 3.6)
    trackerHeading: 'Progress',
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
    stage: {
      INVENTORY_MANAGER: 'Inventory Manager',
      APPROVER: 'Approver',
    },
  },

  boms: {
    title: 'Bills of Materials',
    subtitle: 'Group approved requisitions into a payable document for Accounts.',
    newBom: 'New BOM',

    // list
    bomNo: 'BOM number',
    sources: 'Sources',
    noSources: '—',
    generatedAt: 'Generated',
    generatedBy: 'By',
    pdfStatus: 'PDF',
    pdfReady: 'PDF on file',
    pdfPending: 'PDF pending',
    voidedLabel: 'Voided',

    // detail
    approvedTotal: 'Approved total',
    bomSubtotal: 'BOM subtotal',
    variance: 'Variance',
    ceiling: 'Ceiling (+{pct}%)',
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
    bounceWarning:
      'This BOM will bounce — its sources will return to the approver queue.',
    generate: 'Generate BOM',
    generatedToast: 'BOM created.',
    approved: 'Approved',

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
    VALIDATION_FAILED: 'Please correct the highlighted fields.',
    BORROW_INVALID_TRANSITION: 'That is no longer possible for this request. Refresh to see why.',
    BORROW_ALREADY_DECIDED: 'Someone already acted on this. Refresh to see the outcome.',
    DUPLICATE_PROJECT_NAME: 'A project with that name already exists.',
    REQUISITION_INVALID_TRANSITION:
      'That is no longer possible for this requisition. Refresh to see its current stage.',
    APPROVAL_ALREADY_ACTED: 'Someone already acted on this approval. Refresh to see the outcome.',
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
    STOCK_VERSION_CONFLICT:
      'This stock changed while the screen was open. The figures have been refreshed — check them and try again.',
    CATEGORY_NOT_TRACKABLE: 'That category does not track stock, so it cannot hold quantities.',
    STOCK_RESERVED: 'Those units are reserved for a pending borrow and cannot be moved or removed.',
    BOM_OVER_BUDGET:
      'This BOM was over budget and bounced. Adjust the unit costs and try again.',
    BOM_REQUISITION_NOT_APPROVED:
      'One of the selected requisitions is no longer approved. Refresh and try again.',
    BOM_REQUISITION_ALREADY_ON_LIVE_BOM:
      'One of the selected requisitions is already on a live BOM.',
    BOM_ALREADY_ON_LIVE_BOM:
      'One of the selected requisitions is already on a live BOM.',
    BOM_ALREADY_VOID: 'This BOM has already been voided.',
    PDF_RENDER_FAILED: 'The PDF could not be rendered. Try again.',
    PDF_DOWNLOAD_TOKEN_INVALID: 'This download link has expired.',
    INTERNAL: 'Something went wrong on the server.',
    NETWORK: 'Cannot reach the server.',
  },
} as const;

export type Copy = typeof t;
