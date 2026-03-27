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
                    content: d.content ? d.content.substring(0, 200) : null,
                    fileUrl: d.fileUrl || null,
                    creditsUsed: d.creditsUsed ?? null,
                    usageCount: d.usageCount ?? 0,
                    pitchId: d.pitchId || null,
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
                    content: d.extractedText ? d.extractedText.substring(0, 200) : null,
                    fileUrl: d.storageUrl || null,
                    creditsUsed: null,
                    usageCount: 0,
                    pitchId: null,
                    templateType: null,
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
 * Route handler for /library/* paths
 */
async function handle(req, res) {
    const method = req.method;
    const path = req.normalizedPath || req.path;

    // GET /library/items
    if (path === '/library/items' && method === 'GET') {
        return listItems(req, res);
    }

    // POST /library/items
    if (path === '/library/items' && method === 'POST') {
        return createItem(req, res);
    }

    // DELETE /library/items/:itemId
    const deleteMatch = path.match(/^\/library\/items\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
        req.params = req.params || {};
        req.params.itemId = deleteMatch[1];
        return deleteItem(req, res);
    }

    return false; // Not handled
}

module.exports = {
    handle,
    listItems,
    createItem,
    deleteItem
};
