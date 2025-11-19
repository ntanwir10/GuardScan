# ADR 004: TypeScript Strict Mode

## Status
Accepted

## Date
2024-11-19

## Context
GuardScan is a security-focused code analysis tool that processes code and provides recommendations. The codebase quality and type safety directly impact:

1. **Reliability** - Bugs can lead to incorrect security findings
2. **Maintainability** - Type safety makes refactoring safer
3. **Developer confidence** - Strong types catch errors early
4. **Security** - Type-related bugs can introduce vulnerabilities
5. **Code quality** - Types serve as inline documentation

We needed to decide on TypeScript configuration:
- **Loose mode**: `strict: false` - More JavaScript-like, fewer errors
- **Strict mode**: `strict: true` - Maximum type safety
- **Selective strict**: Enable specific checks individually

## Decision
We enable **TypeScript strict mode** (`strict: true`) across the entire codebase, including:
- `noImplicitAny`
- `strictNullChecks`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `alwaysStrict`

Additionally, we enable extra strictness:
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`

## Rationale

### Benefits of Strict Mode

1. **Null Safety**
   ```typescript
   // Strict mode prevents null/undefined bugs
   function processFile(file: File | null) {
     // ❌ Error: Object is possibly null
     return file.name;
     
     // ✅ Correct: Handle null case
     return file?.name ?? 'unknown';
   }
   ```

2. **Type Safety**
   ```typescript
   // Prevents implicit any
   function analyze(code) {  // ❌ Error: Parameter 'code' implicitly has 'any' type
     return code.length;
   }
   
   function analyze(code: string): number {  // ✅ Correct
     return code.length;
   }
   ```

3. **Function Types**
   ```typescript
   // Strict function types catch contravariance issues
   interface Handler {
     handle(error: Error): void;
   }
   
   const handler: Handler = {
     // ❌ Error: Not assignable
     handle(error: TypeError) { }
   };
   ```

4. **Property Initialization**
   ```typescript
   class Scanner {
     // ❌ Error: Property 'rules' has no initializer
     rules: Rule[];
     
     // ✅ Correct options:
     rules: Rule[] = [];              // Initialize
     rules!: Rule[];                  // Definite assignment
     constructor(rules: Rule[]) {     // Constructor assignment
       this.rules = rules;
     }
   }
   ```

### Real-World Impact on GuardScan

**Before Strict Mode:**
```typescript
// Real bug: Null pointer in secrets detector
function maskSecret(secret: string) {
  return secret.substring(0, 4) + '***';  // Crashes on null
}

maskSecret(null);  // Runtime error! ❌
```

**After Strict Mode:**
```typescript
// Type system catches the bug
function maskSecret(secret: string | null) {
  if (!secret) return '***';  // Handle null
  return secret.substring(0, 4) + '***';  // Safe ✅
}

maskSecret(null);  // Handled gracefully ✅
```

**Security Impact:**
```typescript
// Before: Potential security vulnerability
function sanitizeInput(input) {  // any type
  return input.replace(/</g, '&lt;');  // Crashes if input is not a string
}

// After: Type-safe and secure
function sanitizeInput(input: string): string {
  return input.replace(/</g, '&lt;');  // Type-safe ✅
}
```

### Performance Considerations

**Strict mode does NOT affect runtime performance:**
- TypeScript compiles to same JavaScript
- Type checks happen at build time only
- No runtime overhead
- Smaller bundle size (better tree-shaking)

**Development time impact:**
- Initial conversion: ~2-3 days for existing code
- Ongoing: Minimal impact (catches bugs faster)
- Refactoring: Much safer and faster
- Onboarding: Types serve as documentation

## Consequences

### Positive
- **Fewer bugs**: Caught at compile time instead of runtime
- **Better IDE support**: IntelliSense, autocomplete, refactoring
- **Self-documenting code**: Types explain expected inputs/outputs
- **Safer refactoring**: Type errors guide changes
- **Fewer tests needed**: Type system proves correctness
- **Better collaboration**: Types are contracts between modules

### Negative
- **Steeper learning curve**: New developers need TypeScript knowledge
  - *Mitigation*: Excellent TypeScript documentation
  - *Mitigation*: Team knowledge sharing
  - *Mitigation*: Types improve onboarding once learned
  
- **More verbose code**: Type annotations add lines
  - *Mitigation*: Type inference reduces annotations
  - *Mitigation*: Utility types (Pick, Omit, Partial) reduce boilerplate
  - *Mitigation*: Verbosity improves clarity
  
- **Slower iteration**: Must satisfy type checker
  - *Mitigation*: Type errors prevent bugs, saving time overall
  - *Mitigation*: Can use `@ts-ignore` for truly exceptional cases
  - *Mitigation*: Incremental compilation is fast

### Trade-offs

**What We Give Up:**
- Dynamic JavaScript patterns (rare in modern code)
- Implicit any (usually a bug source)
- Null/undefined flexibility (usually causes errors)

**What We Gain:**
- Early error detection
- Refactoring confidence
- Better tooling support
- Self-documenting code

## Implementation Details

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    
    // Strict Type-Checking Options
    "strict": true,                      // Enable all strict checks
    "noImplicitAny": true,               // Error on implied 'any'
    "strictNullChecks": true,            // Null/undefined are distinct types
    "strictFunctionTypes": true,         // Strict function type checking
    "strictBindCallApply": true,         // Strict bind/call/apply
    "strictPropertyInitialization": true,// Class properties must be initialized
    "noImplicitThis": true,              // Error on 'this' with implied 'any'
    "alwaysStrict": true,                // Parse in strict mode
    
    // Additional Checks
    "noUnusedLocals": true,              // Error on unused local variables
    "noUnusedParameters": true,          // Error on unused parameters
    "noImplicitReturns": true,           // Error if not all code paths return
    "noFallthroughCasesInSwitch": true,  // Error on switch fallthrough
    
    // Module Resolution
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    
    // Source Maps
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Common Patterns

**1. Nullable Types**
```typescript
function getConfig(key: string): string | null {
  const value = process.env[key];
  return value ?? null;
}

// Usage
const apiKey = getConfig('API_KEY');
if (apiKey) {
  // TypeScript knows apiKey is string here
  connectToAPI(apiKey);
}
```

**2. Optional Parameters**
```typescript
function scan(
  files: string[],
  options?: ScanOptions  // Optional
): ScanResult {
  const depth = options?.depth ?? 5;  // Safe access
  return performScan(files, depth);
}
```

**3. Type Guards**
```typescript
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function handleResult(result: Success | Error) {
  if (isError(result)) {
    // TypeScript knows result is Error here
    console.error(result.message);
  } else {
    // TypeScript knows result is Success here
    console.log(result.data);
  }
}
```

**4. Discriminated Unions**
```typescript
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function processResult<T>(result: Result<T>): T {
  if (result.success) {
    return result.data;  // TypeScript knows shape
  } else {
    throw new Error(result.error);  // TypeScript knows shape
  }
}
```

**5. Utility Types**
```typescript
interface Config {
  apiKey: string;
  debug: boolean;
  timeout: number;
}

// Partial config for updates
type ConfigUpdate = Partial<Config>;

// Read-only config
type ReadonlyConfig = Readonly<Config>;

// Pick specific fields
type ApiConfig = Pick<Config, 'apiKey' | 'timeout'>;
```

### Migration Strategy

1. **Enable strict mode** in tsconfig.json
2. **Fix errors incrementally** by module:
   - Core utilities first
   - Domain logic second
   - Integrations last
3. **Use `@ts-ignore` sparingly** for truly exceptional cases
4. **Document workarounds** with comments explaining why

## Alternatives Considered

**Loose Mode (`strict: false`)**
- ✅ Easier for beginners
- ✅ Faster initial development
- ❌ More runtime bugs
- ❌ Harder to maintain
- ❌ Poor IDE support

**Selective Strict**
- ✅ Gradual adoption
- ❌ Inconsistent codebase
- ❌ Confusion about which rules apply where
- ❌ Missed benefits of full strictness

**Flow**
- ✅ Similar type safety
- ❌ Smaller community
- ❌ Less mature tooling
- ❌ TypeScript has won the ecosystem

## Related Decisions
- [ADR 005: BYOK AI Model](./005-byok-ai-model.md) - Type-safe AI provider interfaces

## References
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Strict Mode Benefits](https://blog.logrocket.com/typescript-strict-mode/)

## Review
This decision is fundamental and should rarely change. Review if:
- TypeScript introduces new strict flags
- Team consensus changes significantly

**Next review date**: 2025-11-19 (1 year)

