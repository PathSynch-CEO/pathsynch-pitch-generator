/**
 * Unified Library API
 *
 * Merges Intel items (library/{userId}/items) with Sales items
 * (salesDocuments collection) into a single flat list.
 * Templates are stored in library/{userId}/items with type=template.
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * GET /library/items
 * Query params: type (intel|sales|template|all), subType, q (search)
 */
async function listItems(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        const typeFilter = req.query.type || 'all';
        const subTypeFilter = req.query.subType || null;
        const searchQuery = (req.query.q || '').toLowerCase().trim();
        const sortBy = req.query.sort || 'recent'; // recent | oldest | most_used

        // Parallel fetch: intel/template items + sales documents
        const [intelSnap, salesSnap] = await Promise.all([
            // Only skip if filtering exclusively by sales
            typeFilter === 'sales'
                ? Promise.resolve(null)
                : db.collection('library').doc(userId).collection('items').get(),
            // Only skip if filtering exclusively by intel or template
            (typeFilter === 'intel' || typeFilter === 'template')
                ? Promise.resolve(null)
                : db.collection('salesDocuments').where('userId', '==', userId).get()
        ]);

        const items = [];

        // Map intel/template items from library subcollection
        if (intelSnap && !intelSnap.empty) {
            intelSnap.docs.forEach(doc => {
                const d = doc.data();
                // Apply type filter
                if (typeFilter !== 'all' && d.type !== typeFilter) return;
                // Apply subType filter
                if (subTypeFilter && d.subType !== subTypeFilter) return;

                items.push({
                    id: doc.id,
                    source: 'library',
                    type: d.type || 'intel',
                    subType: d.subType || null,
                    title: d.title || 'Untitled',
                    industry: d.industry || null,
                    city: d.city || null,
                    content: (d.type === 'intel' && d.subType === 'market')
                        ? d.content  // full content for market intel (batch pitch generation needs leads)
                        : (d.content || '').substring(0, 500) || null,
                    fileUrl: d.fileUrl || null,
                    creditsUsed: d.creditsUsed ?? null,
                    usageCount: d.usageCount ?? 0,
                    pitchId: d.pitchId || null,
                    isTemplate: d.isTemplate || false,
                    templateType: d.templateType || null,
                    createdAt: d.createdAt?.toDate?.() || d.createdAt || null
                });
            });
        }

        // Map sales documents into unified format
        if (salesSnap && !salesSnap.empty) {
            salesSnap.docs.forEach(doc => {
                const d = doc.data();
                // Apply subType filter (sales_asset or case_study map from documentType)
                const mappedSubType = d.documentType === 'case_study' ? 'case_study' : 'sales_asset';
                if (subTypeFilter && mappedSubType !== subTypeFilter) return;

                items.push({
                    id: doc.id,
                    source: 'salesDocuments',
                    type: 'sales',
                    subType: mappedSubType,
                    title: d.documentLabel || d.fileName || 'Untitled',
                    industry: null,
                    city: null,
                    content: d.extractedText ? d.extractedText.substring(0, 500) : null,
                    fileUrl: d.storageUrl || null,
                    creditsUsed: null,
                    usageCount: 0,
                    pitchId: null,
                    isTemplate: d.isTemplate || false,
                    templateType: d.templateType || null,
                    wordCount: d.wordCount || null,
                    pageCount: d.pageCount || null,
                    documentType: d.documentType || 'other',
                    status: d.status || 'ready',
                    createdAt: d.uploadedAt?.toDate?.() || d.uploadedAt || null
                });
            });
        }

        // Apply search filter
        let filtered = items;
        if (searchQuery) {
            filtered = items.filter(item => {
                const haystack = [item.title, item.content, item.industry, item.city, item.subType]
                    .filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(searchQuery);
            });
        }

        // Sort
        filtered.sort((a, b) => {
            if (sortBy === 'oldest') {
                const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
                const db2 = b.createdAt ? new Date(b.createdAt) : new Date(0);
                return da - db2;
            }
            if (sortBy === 'most_used') {
                return (b.usageCount || 0) - (a.usageCount || 0);
            }
            // Default: most recent
            const da = a.createdAt ? new Date(a.createdAt) : new Date(0);
            const db2 = b.createdAt ? new Date(b.createdAt) : new Date(0);
            return db2 - da;
        });

        return res.status(200).json({
            success: true,
            data: {
                items: filtered,
                count: filtered.length
            }
        });
    } catch (error) {
        console.error('[Library] listItems error:', error);
        return res.status(500).json({ success: false, error: 'Failed to list library items' });
    }
}

/**
 * POST /library/items
 * Create a new library item (intel, sales, or template)
 */
async function createItem(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { type, subType, title, content, fileUrl, industry, city, templateType } = req.body || {};

    if (!type || !title) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: type, title'
        });
    }

    const validTypes = ['intel', 'sales', 'template'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    try {
        const itemData = {
            type,
            subType: subType || null,
            title,
            content: content || null,
            fileUrl: fileUrl || null,
            industry: industry || null,
            city: city || null,
            templateType: templateType || null,
            creditsUsed: 0,
            usageCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('library').doc(userId).collection('items').add(itemData);

        return res.status(201).json({
            success: true,
            data: { id: docRef.id, ...itemData, createdAt: new Date().toISOString() }
        });
    } catch (error) {
        console.error('[Library] createItem error:', error);
        return res.status(500).json({ success: false, error: 'Failed to create library item' });
    }
}

/**
 * PATCH /library/items/:itemId
 * Update fields on a library item (supports isTemplate, templateType, title, etc.)
 * Also supports salesDocuments items.
 */
async function updateItem(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const itemId = req.params.itemId;
    if (!itemId) {
        return res.status(400).json({ success: false, error: 'Item ID required' });
    }

    const updates = req.body || {};
    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    // Validate templateType if provided
    if ('templateType' in updates && updates.templateType !== null) {
        if (typeof updates.templateType !== 'string' || updates.templateType.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'templateType must be a non-empty string' });
        }
        updates.templateType = updates.templateType.trim().toLowerCase();
    }

    // Whitelist allowed fields
    const allowed = ['isTemplate', 'templateType', 'title', 'content', 'subType', 'industry', 'city'];
    const safeUpdates = {};
    for (const key of allowed) {
        if (key in updates) safeUpdates[key] = updates[key];
    }

    if (Object.keys(safeUpdates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    try {
        // Try library subcollection first
        const libRef = db.collection('library').doc(userId).collection('items').doc(itemId);
        const libDoc = await libRef.get();

        if (libDoc.exists) {
            await libRef.update(safeUpdates);
            return res.status(200).json({ success: true, data: { id: itemId, ...safeUpdates } });
        }

        // Try salesDocuments collection
        const salesRef = db.collection('salesDocuments').doc(itemId);
        const salesDoc = await salesRef.get();

        if (salesDoc.exists && salesDoc.data().userId === userId) {
            await salesRef.update(safeUpdates);
            return res.status(200).json({ success: true, data: { id: itemId, ...safeUpdates } });
        }

        return res.status(404).json({ success: false, error: 'Item not found' });
    } catch (error) {
        console.error('[Library] updateItem error:', error);
        return res.status(500).json({ success: false, error: 'Failed to update item' });
    }
}

/**
 * GET /library/templates
 * Returns items where isTemplate === true, grouped by templateType.
 */
async function listTemplates(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        // Fetch from both sources in parallel
        const [libSnap, salesSnap] = await Promise.all([
            db.collection('library').doc(userId).collection('items')
                .where('isTemplate', '==', true).get(),
            db.collection('salesDocuments')
                .where('userId', '==', userId)
                .where('isTemplate', '==', true).get()
        ]);

        const templates = [];

        if (libSnap && !libSnap.empty) {
            libSnap.docs.forEach(doc => {
                const d = doc.data();
                templates.push({
                    id: doc.id,
                    title: d.title || 'Untitled',
                    templateType: d.templateType || 'general',
                    createdAt: d.createdAt?.toDate?.() || d.createdAt || null,
                    contentPreview: (d.content || '').substring(0, 200)
                });
            });
        }

        if (salesSnap && !salesSnap.empty) {
            salesSnap.docs.forEach(doc => {
                const d = doc.data();
                templates.push({
                    id: doc.id,
                    title: d.documentLabel || d.fileName || 'Untitled',
                    templateType: d.templateType || 'general',
                    createdAt: d.uploadedAt?.toDate?.() || d.uploadedAt || null,
                    contentPreview: (d.extractedText || '').substring(0, 200)
                });
            });
        }

        // Group by templateType
        const byType = {};
        templates.forEach(t => {
            const type = t.templateType || 'general';
            if (!byType[type]) byType[type] = [];
            byType[type].push(t);
        });

        return res.status(200).json({
            success: true,
            templates,
            byType
        });
    } catch (error) {
        console.error('[Library] listTemplates error:', error);
        return res.status(500).json({ success: false, error: 'Failed to list templates' });
    }
}

/**
 * DELETE /library/items/:itemId
 */
async function deleteItem(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const itemId = req.params.itemId;
    if (!itemId) {
        return res.status(400).json({ success: false, error: 'Item ID required' });
    }

    try {
        const docRef = db.collection('library').doc(userId).collection('items').doc(itemId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }

        await docRef.delete();
        return res.status(200).json({ success: true, message: 'Item deleted' });
    } catch (error) {
        console.error('[Library] deleteItem error:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete item' });
    }
}

/**
 * GET /library/items/:itemId
 * Returns full item detail including complete content.
 */
async function getItem(req, res) {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const itemId = req.params.itemId;
    if (!itemId) {
        return res.status(400).json({ success: false, error: 'Item ID required' });
    }

    try {
        // Check library subcollection first
        const libRef = db.collection('library').doc(userId).collection('items').doc(itemId);
        const libDoc = await libRef.get();

        if (libDoc.exists) {
            const d = libDoc.data();
            return res.status(200).json({
                success: true,
                id: libDoc.id,
                source: 'library',
                type: d.type || 'intel',
                subType: d.subType || null,
                title: d.title || 'Untitled',
                industry: d.industry || null,
                city: d.city || null,
                content: d.content || null,
                fileUrl: d.fileUrl || null,
                creditsUsed: d.creditsUsed ?? null,
                usageCount: d.usageCount ?? 0,
                pitchId: d.pitchId || null,
                templateType: d.templateType || null,
                createdAt: d.createdAt?.toDate?.() || d.createdAt || null
            });
        }

        // Check salesDocuments collection
        const salesRef = db.collection('salesDocuments').doc(itemId);
        const salesDoc = await salesRef.get();

        if (salesDoc.exists && salesDoc.data().userId === userId) {
            const d = salesDoc.data();
            return res.status(200).json({
                success: true,
                id: salesDoc.id,
                source: 'salesDocuments',
                type: 'sales',
                subType: d.documentType === 'case_study' ? 'case_study' : 'sales_asset',
                title: d.documentLabel || d.fileName || 'Untitled',
                content: d.extractedText || null,
                fileUrl: d.storageUrl || null,
                createdAt: d.uploadedAt?.toDate?.() || d.uploadedAt || null
            });
        }

        return res.status(404).json({ success: false, error: 'Item not found' });
    } catch (error) {
        console.error('[Library] getItem error:', error);
        return res.status(500).json({ success: false, error: 'Failed to get item' });
    }
}

/**
 * Route handler for /library/* paths
 */
async function handle(req, res) {
    const method = req.method;
    const path = req.normalizedPath || req.path;

    // GET /library/items (exact match — list)
    if (path === '/library/items' && method === 'GET') {
        return listItems(req, res);
    }

    // POST /library/items
    if (path === '/library/items' && method === 'POST') {
        return createItem(req, res);
    }

    // GET /library/templates
    if (path === '/library/templates' && method === 'GET') {
        return listTemplates(req, res);
    }

    // GET/PATCH/DELETE /library/items/:itemId
    const itemMatch = path.match(/^\/library\/items\/([^/]+)$/);
    if (itemMatch && method === 'GET') {
        req.params = req.params || {};
        req.params.itemId = itemMatch[1];
        return getItem(req, res);
    }
    if (itemMatch && method === 'PATCH') {
        req.params = req.params || {};
        req.params.itemId = itemMatch[1];
        return updateItem(req, res);
    }
    if (itemMatch && method === 'DELETE') {
        req.params = req.params || {};
        req.params.itemId = itemMatch[1];
        return deleteItem(req, res);
    }

    return false; // Not handled
}

module.exports = {
    handle,
    listItems,
    createItem,
    getItem,
    updateItem,
    deleteItem,
    listTemplates
};
