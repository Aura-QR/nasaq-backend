import { Schema, Types } from 'mongoose';
import { tenantLocalStorage } from '../tenant-storage';

export function tenantScopedPlugin(schema: Schema) {
  // Add schoolId field definition to the schema
  schema.add({
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
  });

  // Query hook to inject schoolId
  const applyTenantScope = function (this: any) {
    const store = tenantLocalStorage.getStore();
    
    // Check if the query explicitly requested to skip tenant scoping
    const options = this.getOptions();
    if (options && options.skipTenantScope) {
      return;
    }

    if (store && store.schoolId) {
      const query = this.getQuery();
      if (!query.schoolId) {
        this.where({ schoolId: new Types.ObjectId(store.schoolId) });
      }
    } else if (!store || (!store.schoolId && !store.isAdminContext)) {
      // Block or scope to null if no active tenant context is present and it is not a platform context
      this.where({ schoolId: null });
    }
  };

  // Register pre-hooks for read/update/delete queries.
  //
  // Every method that can reach a document by _id alone must be listed here,
  // otherwise a caller holding an id from another school reaches that school's
  // data. Note the Model helpers compile down to these:
  //   findById          -> findOne
  //   findByIdAndUpdate -> findOneAndUpdate
  //   findByIdAndDelete -> findOneAndDelete   <-- was missing
  const queryMethods = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'replaceOne',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'count',
    'distinct',
  ];

  queryMethods.forEach((method) => {
    schema.pre(method as any, applyTenantScope);
  });

  // Pre-validate hook: auto-inject and validate schoolId before mongoose validation runs
  schema.pre('validate', function (this: any, next) {
    const store = tenantLocalStorage.getStore();

    if (this.isNew) {
      if (store && store.schoolId) {
        if (!this.schoolId) {
          this.schoolId = new Types.ObjectId(store.schoolId);
        } else if (this.schoolId.toString() !== store.schoolId) {
          return next(new Error('Tenant mismatch: cannot save document under a different schoolId.'));
        }
      } else if (!store || (!store.schoolId && !store.isAdminContext)) {
        return next(new Error('Tenant context missing: schoolId required to save tenant-scoped document.'));
      }
    } else {
      // Prevent mutating schoolId once set
      if (this.isModified('schoolId')) {
        return next(new Error('Unauthorized mutation: schoolId cannot be modified once set.'));
      }
    }
    next();
  });

  // Pre-aggregate hook to inject $match stage
  schema.pre('aggregate', function (this: any) {
    const store = tenantLocalStorage.getStore();
    const options = this.options || {};
    
    if (options.skipTenantScope) {
      return;
    }

    const pipeline = this.pipeline();
    
    if (store && store.schoolId) {
      pipeline.unshift({
        $match: { schoolId: new Types.ObjectId(store.schoolId) }
      });
    } else if (!store || (!store.schoolId && !store.isAdminContext)) {
      pipeline.unshift({
        $match: { schoolId: null }
      });
    }
  });
}
