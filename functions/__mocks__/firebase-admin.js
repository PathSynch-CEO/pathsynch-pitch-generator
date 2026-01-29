/**
 * Firebase Admin SDK Mock
 *
 * Provides mock implementations for Firebase Admin SDK
 * used in unit testing without connecting to real Firebase.
 */

// In-memory data stores for testing
const mockData = {
  collections: {},
  users: {}
};

/**
 * Reset all mock data (call in beforeEach)
 */
function resetMockData() {
  mockData.collections = {};
  mockData.users = {};
}

/**
 * Set mock data for a collection
 */
function setMockCollection(collectionName, documents) {
  mockData.collections[collectionName] = documents;
}

/**
 * Set mock user for auth
 */
function setMockUser(uid, userData) {
  mockData.users[uid] = userData;
}

/**
 * Mock DocumentSnapshot
 */
class MockDocumentSnapshot {
  constructor(id, data, exists = true, collectionName = null) {
    this.id = id;
    this._data = data;
    this.exists = exists && data !== undefined;
    this._collectionName = collectionName;
    // Add ref property for batch operations
    if (collectionName) {
      this.ref = new MockDocumentReference(collectionName, id);
    }
  }

  data() {
    return this._data;
  }

  get(field) {
    return this._data?.[field];
  }
}

/**
 * Mock QuerySnapshot
 */
class MockQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }

  forEach(callback) {
    this.docs.forEach(callback);
  }
}

/**
 * Mock DocumentReference
 */
class MockDocumentReference {
  constructor(collectionName, docId) {
    this.collectionName = collectionName;
    this.id = docId;
    this.path = `${collectionName}/${docId}`;
  }

  async get() {
    const collection = mockData.collections[this.collectionName] || {};
    const data = collection[this.id];
    return new MockDocumentSnapshot(this.id, data);
  }

  async set(data, options = {}) {
    if (!mockData.collections[this.collectionName]) {
      mockData.collections[this.collectionName] = {};
    }

    if (options.merge) {
      mockData.collections[this.collectionName][this.id] = {
        ...mockData.collections[this.collectionName][this.id],
        ...data
      };
    } else {
      mockData.collections[this.collectionName][this.id] = data;
    }

    return this;
  }

  async update(data) {
    if (!mockData.collections[this.collectionName]?.[this.id]) {
      throw new Error('Document does not exist');
    }

    mockData.collections[this.collectionName][this.id] = {
      ...mockData.collections[this.collectionName][this.id],
      ...data
    };

    return this;
  }

  async delete() {
    if (mockData.collections[this.collectionName]) {
      delete mockData.collections[this.collectionName][this.id];
    }
    return this;
  }

  collection(name) {
    return new MockCollectionReference(`${this.collectionName}/${this.id}/${name}`);
  }
}

/**
 * Mock Query
 */
class MockQuery {
  constructor(collectionName, filters = [], orderByField = null, orderDirection = 'asc', limitCount = null) {
    this.collectionName = collectionName;
    this.filters = filters;
    this.orderByField = orderByField;
    this.orderDirection = orderDirection;
    this.limitCount = limitCount;
    this.offsetCount = 0;
  }

  where(field, operator, value) {
    return new MockQuery(
      this.collectionName,
      [...this.filters, { field, operator, value }],
      this.orderByField,
      this.orderDirection,
      this.limitCount
    );
  }

  orderBy(field, direction = 'asc') {
    return new MockQuery(
      this.collectionName,
      this.filters,
      field,
      direction,
      this.limitCount
    );
  }

  limit(count) {
    const query = new MockQuery(
      this.collectionName,
      this.filters,
      this.orderByField,
      this.orderDirection,
      count
    );
    query.offsetCount = this.offsetCount;
    return query;
  }

  offset(count) {
    const query = new MockQuery(
      this.collectionName,
      this.filters,
      this.orderByField,
      this.orderDirection,
      this.limitCount
    );
    query.offsetCount = count;
    return query;
  }

  startAfter() {
    return this;
  }

  async get() {
    const collection = mockData.collections[this.collectionName] || {};
    let docs = Object.entries(collection).map(([id, data]) =>
      new MockDocumentSnapshot(id, data, true, this.collectionName)
    );

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter(doc => {
        const value = doc.data()?.[filter.field];
        switch (filter.operator) {
          case '==': return value === filter.value;
          case '!=': return value !== filter.value;
          case '>': return value > filter.value;
          case '>=': return value >= filter.value;
          case '<': return value < filter.value;
          case '<=': return value <= filter.value;
          case 'in': return filter.value.includes(value);
          case 'array-contains': return Array.isArray(value) && value.includes(filter.value);
          default: return true;
        }
      });
    }

    // Apply ordering
    if (this.orderByField) {
      docs.sort((a, b) => {
        const aVal = a.data()?.[this.orderByField];
        const bVal = b.data()?.[this.orderByField];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return this.orderDirection === 'desc' ? -cmp : cmp;
      });
    }

    // Apply offset
    if (this.offsetCount > 0) {
      docs = docs.slice(this.offsetCount);
    }

    // Apply limit
    if (this.limitCount) {
      docs = docs.slice(0, this.limitCount);
    }

    return new MockQuerySnapshot(docs);
  }

  async count() {
    const snapshot = await this.get();
    return {
      data: () => ({ count: snapshot.size })
    };
  }
}

/**
 * Mock CollectionReference
 */
class MockCollectionReference extends MockQuery {
  constructor(name) {
    super(name);
    this.name = name;
  }

  doc(id) {
    const docId = id || `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return new MockDocumentReference(this.name, docId);
  }

  async add(data) {
    const docId = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const docRef = new MockDocumentReference(this.name, docId);
    await docRef.set(data);
    return docRef;
  }
}

/**
 * Mock WriteBatch
 */
class MockWriteBatch {
  constructor() {
    this.operations = [];
  }

  set(docRef, data, options = {}) {
    this.operations.push({ type: 'set', docRef, data, options });
    return this;
  }

  update(docRef, data) {
    this.operations.push({ type: 'update', docRef, data });
    return this;
  }

  delete(docRef) {
    this.operations.push({ type: 'delete', docRef });
    return this;
  }

  async commit() {
    for (const op of this.operations) {
      if (op.type === 'set') {
        await op.docRef.set(op.data, op.options);
      } else if (op.type === 'update') {
        await op.docRef.update(op.data);
      } else if (op.type === 'delete') {
        await op.docRef.delete();
      }
    }
    return;
  }
}

/**
 * Mock Transaction
 */
class MockTransaction {
  constructor() {
    this.operations = [];
  }

  async get(docRef) {
    const collection = mockData.collections[docRef.collectionName] || {};
    const data = collection[docRef.id];
    return new MockDocumentSnapshot(docRef.id, data);
  }

  set(docRef, data, options = {}) {
    this.operations.push({ type: 'set', docRef, data, options });
    return this;
  }

  update(docRef, data) {
    this.operations.push({ type: 'update', docRef, data });
    return this;
  }

  delete(docRef) {
    this.operations.push({ type: 'delete', docRef });
    return this;
  }

  async _commit() {
    for (const op of this.operations) {
      if (op.type === 'set') {
        if (!mockData.collections[op.docRef.collectionName]) {
          mockData.collections[op.docRef.collectionName] = {};
        }
        if (op.options.merge) {
          mockData.collections[op.docRef.collectionName][op.docRef.id] = {
            ...mockData.collections[op.docRef.collectionName][op.docRef.id],
            ...op.data
          };
        } else {
          mockData.collections[op.docRef.collectionName][op.docRef.id] = op.data;
        }
      } else if (op.type === 'update') {
        if (!mockData.collections[op.docRef.collectionName]) {
          mockData.collections[op.docRef.collectionName] = {};
        }
        // Handle FieldValue.increment
        const currentData = mockData.collections[op.docRef.collectionName][op.docRef.id] || {};
        const newData = { ...currentData };
        for (const [key, value] of Object.entries(op.data)) {
          if (value && value._increment !== undefined) {
            newData[key] = (currentData[key] || 0) + value._increment;
          } else {
            newData[key] = value;
          }
        }
        mockData.collections[op.docRef.collectionName][op.docRef.id] = newData;
      } else if (op.type === 'delete') {
        if (mockData.collections[op.docRef.collectionName]) {
          delete mockData.collections[op.docRef.collectionName][op.docRef.id];
        }
      }
    }
  }
}

/**
 * Mock Firestore
 */
const mockFirestore = {
  collection: (name) => new MockCollectionReference(name),
  batch: () => new MockWriteBatch(),
  runTransaction: jest.fn(async (callback) => {
    const transaction = new MockTransaction();
    const result = await callback(transaction);
    await transaction._commit();
    return result;
  })
};

/**
 * Mock Auth
 */
const mockAuth = {
  verifyIdToken: jest.fn(async (token) => {
    // Return decoded token based on test token format
    if (token.startsWith('valid_')) {
      const uid = token.replace('valid_', '');
      const user = mockData.users[uid] || { uid, email: `${uid}@test.com` };
      return { uid: user.uid, email: user.email };
    }
    throw new Error('Invalid token');
  }),

  getUser: jest.fn(async (uid) => {
    const user = mockData.users[uid];
    if (!user) {
      const error = new Error('User not found');
      error.code = 'auth/user-not-found';
      throw error;
    }
    return user;
  }),

  createUser: jest.fn(async (properties) => {
    const uid = properties.uid || `user_${Date.now()}`;
    const user = { uid, ...properties };
    mockData.users[uid] = user;
    return user;
  }),

  updateUser: jest.fn(async (uid, properties) => {
    if (!mockData.users[uid]) {
      throw new Error('User not found');
    }
    mockData.users[uid] = { ...mockData.users[uid], ...properties };
    return mockData.users[uid];
  }),

  deleteUser: jest.fn(async (uid) => {
    delete mockData.users[uid];
  })
};

/**
 * Mock FieldValue
 */
const mockFieldValue = {
  serverTimestamp: () => ({ _serverTimestamp: true, toDate: () => new Date() }),
  increment: (n) => ({ _increment: n }),
  arrayUnion: (...elements) => ({ _arrayUnion: elements }),
  arrayRemove: (...elements) => ({ _arrayRemove: elements }),
  delete: () => ({ _delete: true })
};

/**
 * Mock Firebase Admin module
 */
const admin = {
  initializeApp: jest.fn(),
  firestore: jest.fn(() => mockFirestore),
  auth: jest.fn(() => mockAuth),

  // Direct access to mocks for configuration in tests
  _mockFirestore: mockFirestore,
  _mockAuth: mockAuth,
  _mockData: mockData,
  _resetMockData: resetMockData,
  _setMockCollection: setMockCollection,
  _setMockUser: setMockUser
};

// Add FieldValue to firestore
admin.firestore.FieldValue = mockFieldValue;

module.exports = admin;
