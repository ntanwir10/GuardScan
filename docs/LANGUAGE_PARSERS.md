# Language Parser Documentation

**GuardScan Multi-Language Parser API Reference**

**Version:** 1.0.0
**Last Updated:** 2025-11-16

---

## Overview

GuardScan includes **8 language parsers** that extract code structure, functions, classes, and complexity metrics from source files. All parsers follow a consistent API pattern for ease of use.

### Supported Languages

1. **TypeScript/JavaScript** - Built-in AST parser
2. **Python** - Dual strategy (Python `ast` module + regex fallback)
3. **Java** - Annotations, generics, Javadoc
4. **Go** - Receivers, interfaces, struct tags
5. **Rust** - Traits, lifetimes, impl blocks
6. **Ruby** - Modules, attr_*, blocks
7. **PHP** - Namespaces, traits, type hints
8. **C#** - Properties, events, LINQ patterns

---

## Common API Pattern

All parsers implement the same interface:

```typescript
interface Parser {
  // Parse a file from disk
  parseFile(filePath: string): Promise<ParsedFile>;

  // Parse code from string
  parseCode(code: string, filePath: string): Promise<ParsedFile>;
}
```

### Common Return Structure

```typescript
interface ParsedFile {
  language: string;           // Language name
  file: string;               // File path
  functions: Function[];      // Extracted functions
  classes: Class[];           // Extracted classes
  imports: Import[];          // Import statements
  exports: Export[];          // Export statements
  complexity: number;         // Total cyclomatic complexity
  loc: number;               // Lines of code
}
```

---

## 1. TypeScript/JavaScript Parser

**Location:** `cli/src/core/ast-parser.ts`

### Features
- Full TypeScript AST parsing
- Arrow functions, async/await
- ES6+ features (classes, modules)
- JSDoc extraction
- Decorator support

### Usage

```typescript
import { ASTParser } from './core/ast-parser';

const parser = new ASTParser();
const result = await parser.parseFile('src/index.ts');

console.log(result.functions);  // All functions
console.log(result.classes);    // All classes
console.log(result.complexity); // Total complexity
```

### Extracted Data

**Function Structure:**
```typescript
interface TSFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  async: boolean;
  parameters: Parameter[];
  returnType?: string;
  complexity: number;
  documentation?: string;
}
```

**Class Structure:**
```typescript
interface TSClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  extends?: string;
  implements?: string[];
  methods: Method[];
  properties: Property[];
  documentation?: string;
}
```

### Example

```typescript
// Input: example.ts
export class Calculator {
  /** Add two numbers */
  add(a: number, b: number): number {
    return a + b;
  }
}

// Output:
{
  classes: [{
    name: 'Calculator',
    methods: [{
      name: 'add',
      parameters: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' }
      ],
      returnType: 'number',
      documentation: 'Add two numbers',
      complexity: 1
    }]
  }]
}
```

---

## 2. Python Parser

**Location:** `cli/src/parsers/python-parser.ts`

### Features
- Dual parsing strategy (Python `ast` + regex fallback)
- Function and class extraction
- Decorator support
- Type hints (PEP 484)
- Docstring extraction

### Usage

```typescript
import { PythonParser } from './parsers/python-parser';

const parser = new PythonParser();
const result = await parser.parseFile('main.py');

console.log(result.functions);
console.log(result.classes);
```

### Parsing Strategies

**1. Python AST (Preferred):**
- Uses Python's `ast` module via `child_process`
- Most accurate parsing
- Requires Python 3.6+ installed

**2. Regex Fallback:**
- Pattern-based extraction
- Works without Python installation
- Less accurate for complex code

### Extracted Data

**Function Structure:**
```typescript
interface PythonFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  async: boolean;
  decorators: string[];
  parameters: PythonParameter[];
  returnType?: string;
  complexity: number;
  documentation?: string;  // Docstring
}
```

**Parameter Structure:**
```typescript
interface PythonParameter {
  name: string;
  type?: string;           // Type hint
  default?: string;        // Default value
  isVarArgs?: boolean;     // *args
  isKwArgs?: boolean;      // **kwargs
}
```

### Example

```python
# Input: calculator.py
from typing import Union

class Calculator:
    """A simple calculator"""

    @staticmethod
    def add(a: int, b: int) -> int:
        """Add two numbers"""
        return a + b

    def multiply(self, x: float, y: float) -> float:
        return x * y

# Output:
{
  classes: [{
    name: 'Calculator',
    documentation: 'A simple calculator',
    methods: [{
      name: 'add',
      decorators: ['staticmethod'],
      parameters: [
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' }
      ],
      returnType: 'int',
      documentation: 'Add two numbers',
      complexity: 1
    }, {
      name: 'multiply',
      parameters: [
        { name: 'self' },
        { name: 'x', type: 'float' },
        { name: 'y', type: 'float' }
      ],
      returnType: 'float',
      complexity: 1
    }]
  }]
}
```

---

## 3. Java Parser

**Location:** `cli/src/parsers/java-parser.ts`

### Features
- Package and import parsing
- Annotations (@Override, @Deprecated, etc.)
- Generics support
- Javadoc extraction
- Inner classes
- Interface detection

### Usage

```typescript
import { JavaParser } from './parsers/java-parser';

const parser = new JavaParser();
const result = await parser.parseFile('Main.java');
```

### Extracted Data

**Function Structure:**
```typescript
interface JavaMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: 'public' | 'private' | 'protected' | 'package';
  static: boolean;
  final: boolean;
  abstract: boolean;
  synchronized: boolean;
  annotations: string[];
  parameters: JavaParameter[];
  returnType: string;
  throws?: string[];
  complexity: number;
  documentation?: string;  // Javadoc
}
```

**Class Structure:**
```typescript
interface JavaClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  package?: string;
  visibility: 'public' | 'private' | 'protected' | 'package';
  abstract: boolean;
  final: boolean;
  extends?: string;
  implements?: string[];
  annotations: string[];
  methods: JavaMethod[];
  fields: JavaField[];
  innerClasses: JavaClass[];
  documentation?: string;
}
```

### Example

```java
// Input: Calculator.java
package com.example;

import java.util.*;

/**
 * A simple calculator
 */
public class Calculator {
    private static final int MAX_VALUE = 1000;

    /**
     * Add two numbers
     * @param a first number
     * @param b second number
     * @return sum
     */
    @Override
    public int add(int a, int b) {
        return a + b;
    }
}

// Output:
{
  classes: [{
    name: 'Calculator',
    package: 'com.example',
    visibility: 'public',
    documentation: 'A simple calculator',
    fields: [{
      name: 'MAX_VALUE',
      type: 'int',
      visibility: 'private',
      static: true,
      final: true
    }],
    methods: [{
      name: 'add',
      visibility: 'public',
      annotations: ['Override'],
      parameters: [
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' }
      ],
      returnType: 'int',
      documentation: 'Add two numbers\n@param a first number\n@param b second number\n@return sum',
      complexity: 1
    }]
  }]
}
```

---

## 4. Go Parser

**Location:** `cli/src/parsers/go-parser.ts`

### Features
- Package parsing
- Receiver methods
- Interface extraction
- Struct field tags
- Multiple return values
- Variadic parameters

### Usage

```typescript
import { GoParser } from './parsers/go-parser';

const parser = new GoParser();
const result = await parser.parseFile('main.go');
```

### Extracted Data

**Function Structure:**
```typescript
interface GoFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;        // Starts with uppercase
  receiver?: {              // Method receiver
    name: string;
    type: string;
    pointer: boolean;
  };
  parameters: GoParameter[];
  returnTypes: string[];    // Multiple returns
  complexity: number;
  documentation?: string;
}
```

**Struct Structure:**
```typescript
interface GoStruct {
  name: string;
  file: string;
  line: number;
  endLine: number;
  exported: boolean;
  fields: GoField[];
  documentation?: string;
}

interface GoField {
  name: string;
  type: string;
  tag?: string;             // Struct tags: `json:"name"`
  exported: boolean;
}
```

### Example

```go
// Input: calculator.go
package main

import "fmt"

// Calculator performs math operations
type Calculator struct {
    Name string `json:"name"`
}

// Add adds two numbers
func (c *Calculator) Add(a, b int) (int, error) {
    if a < 0 || b < 0 {
        return 0, fmt.Errorf("negative numbers not allowed")
    }
    return a + b, nil
}

// Output:
{
  structs: [{
    name: 'Calculator',
    exported: true,
    documentation: 'Calculator performs math operations',
    fields: [{
      name: 'Name',
      type: 'string',
      tag: '`json:"name"`',
      exported: true
    }]
  }],
  functions: [{
    name: 'Add',
    exported: true,
    receiver: {
      name: 'c',
      type: 'Calculator',
      pointer: true
    },
    parameters: [
      { name: 'a', type: 'int' },
      { name: 'b', type: 'int' }
    ],
    returnTypes: ['int', 'error'],
    documentation: 'Add adds two numbers',
    complexity: 2  // if statement adds 1
  }]
}
```

---

## 5. Rust Parser

**Location:** `cli/src/parsers/rust-parser.ts`

### Features
- Module parsing
- Trait and impl block extraction
- Lifetime annotations
- Attribute macros (#[derive])
- Visibility modifiers (pub, pub(crate))
- Generic parameters

### Usage

```typescript
import { RustParser } from './parsers/rust-parser';

const parser = new RustParser();
const result = await parser.parseFile('main.rs');
```

### Extracted Data

**Function Structure:**
```typescript
interface RustFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: 'public' | 'private' | 'pub(crate)' | 'pub(super)';
  async: boolean;
  unsafe: boolean;
  const: boolean;
  attributes: string[];     // #[derive(Debug)]
  generics: string[];       // <T, U>
  lifetimes: string[];      // <'a, 'b>
  parameters: RustParameter[];
  returnType?: string;
  complexity: number;
  documentation?: string;   // /// comments
}
```

**Struct/Enum Structure:**
```typescript
interface RustStruct {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: string;
  attributes: string[];
  generics: string[];
  fields: RustField[];
  documentation?: string;
}
```

### Example

```rust
// Input: calculator.rs
/// A calculator for basic operations
#[derive(Debug, Clone)]
pub struct Calculator {
    pub name: String,
}

impl Calculator {
    /// Create a new calculator
    pub fn new(name: String) -> Self {
        Calculator { name }
    }

    /// Add two numbers
    pub fn add<T: std::ops::Add<Output = T>>(&self, a: T, b: T) -> T {
        a + b
    }
}

// Output:
{
  structs: [{
    name: 'Calculator',
    visibility: 'public',
    attributes: ['derive(Debug, Clone)'],
    documentation: 'A calculator for basic operations',
    fields: [{
      name: 'name',
      type: 'String',
      visibility: 'public'
    }]
  }],
  impls: [{
    type: 'Calculator',
    methods: [{
      name: 'new',
      visibility: 'public',
      parameters: [{ name: 'name', type: 'String' }],
      returnType: 'Self',
      documentation: 'Create a new calculator',
      complexity: 1
    }, {
      name: 'add',
      visibility: 'public',
      generics: ['T: std::ops::Add<Output = T>'],
      parameters: [
        { name: 'self', type: '&self' },
        { name: 'a', type: 'T' },
        { name: 'b', type: 'T' }
      ],
      returnType: 'T',
      documentation: 'Add two numbers',
      complexity: 1
    }]
  }]
}
```

---

## 6. Ruby Parser

**Location:** `cli/src/parsers/ruby-parser.ts`

### Features
- Module and class parsing
- attr_accessor, attr_reader, attr_writer
- Block detection
- Visibility modifiers (public, private, protected)
- Singleton methods
- Mixins (include, extend)

### Usage

```typescript
import { RubyParser } from './parsers/ruby-parser';

const parser = new RubyParser();
const result = await parser.parseFile('calculator.rb');
```

### Extracted Data

**Function Structure:**
```typescript
interface RubyMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: 'public' | 'private' | 'protected';
  class_method: boolean;    // self.method_name
  parameters: RubyParameter[];
  complexity: number;
  documentation?: string;   // # comments
}
```

**Module/Class Structure:**
```typescript
interface RubyClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  type: 'class' | 'module';
  superclass?: string;      // < Parent
  includes: string[];       // include Module
  extends: string[];        // extend Module
  attributes: RubyAttribute[];
  methods: RubyMethod[];
  documentation?: string;
}

interface RubyAttribute {
  name: string;
  type: 'accessor' | 'reader' | 'writer';
  visibility: 'public' | 'private' | 'protected';
}
```

### Example

```ruby
# Input: calculator.rb
module Math
  # A simple calculator
  class Calculator
    attr_accessor :name
    attr_reader :result

    def initialize(name)
      @name = name
      @result = 0
    end

    # Add two numbers
    def add(a, b)
      @result = a + b
    end

    private

    def validate(n)
      n.is_a?(Numeric)
    end
  end
end

# Output:
{
  modules: [{
    name: 'Math',
    classes: [{
      name: 'Calculator',
      documentation: 'A simple calculator',
      attributes: [
        { name: 'name', type: 'accessor', visibility: 'public' },
        { name: 'result', type: 'reader', visibility: 'public' }
      ],
      methods: [{
        name: 'initialize',
        visibility: 'public',
        parameters: [{ name: 'name' }],
        complexity: 1
      }, {
        name: 'add',
        visibility: 'public',
        documentation: 'Add two numbers',
        parameters: [
          { name: 'a' },
          { name: 'b' }
        ],
        complexity: 1
      }, {
        name: 'validate',
        visibility: 'private',
        parameters: [{ name: 'n' }],
        complexity: 1
      }]
    }]
  }]
}
```

---

## 7. PHP Parser

**Location:** `cli/src/parsers/php-parser.ts`

### Features
- Namespace parsing
- Trait extraction
- Type hints (scalar, return types)
- Visibility modifiers
- PHPDoc extraction
- Nullable types (?string)

### Usage

```typescript
import { PHPParser } from './parsers/php-parser';

const parser = new PHPParser();
const result = await parser.parseFile('Calculator.php');
```

### Extracted Data

**Function Structure:**
```typescript
interface PHPMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: 'public' | 'private' | 'protected';
  static: boolean;
  final: boolean;
  abstract: boolean;
  parameters: PHPParameter[];
  returnType?: string;      // : int
  nullable: boolean;        // ?: string
  complexity: number;
  documentation?: string;   // PHPDoc
}

interface PHPParameter {
  name: string;
  type?: string;            // Type hint
  default?: string;
  nullable: boolean;        // ?string
  reference: boolean;       // &$param
  variadic: boolean;        // ...$args
}
```

**Class Structure:**
```typescript
interface PHPClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  namespace?: string;
  visibility: 'public' | 'private' | 'protected';
  abstract: boolean;
  final: boolean;
  extends?: string;
  implements?: string[];
  traits: string[];         // use Trait
  methods: PHPMethod[];
  properties: PHPProperty[];
  documentation?: string;
}
```

### Example

```php
// Input: Calculator.php
<?php
namespace App\Math;

use App\Contracts\CalculatorInterface;

/**
 * Calculator class
 */
class Calculator implements CalculatorInterface
{
    use Loggable;

    private int $result = 0;

    /**
     * Add two numbers
     * @param int $a First number
     * @param int $b Second number
     * @return int Sum
     */
    public function add(int $a, int $b): int
    {
        $this->result = $a + $b;
        return $this->result;
    }

    public static function create(?string $name = null): self
    {
        return new static();
    }
}

// Output:
{
  classes: [{
    name: 'Calculator',
    namespace: 'App\\Math',
    implements: ['CalculatorInterface'],
    traits: ['Loggable'],
    documentation: 'Calculator class',
    properties: [{
      name: 'result',
      type: 'int',
      visibility: 'private',
      default: '0'
    }],
    methods: [{
      name: 'add',
      visibility: 'public',
      parameters: [
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' }
      ],
      returnType: 'int',
      documentation: 'Add two numbers\n@param int $a First number\n@param int $b Second number\n@return int Sum',
      complexity: 1
    }, {
      name: 'create',
      visibility: 'public',
      static: true,
      parameters: [{
        name: 'name',
        type: 'string',
        nullable: true,
        default: 'null'
      }],
      returnType: 'self',
      complexity: 1
    }]
  }]
}
```

---

## 8. C# Parser

**Location:** `cli/src/parsers/csharp-parser.ts`

### Features
- Namespace parsing
- Properties (auto-properties, getters/setters)
- Events and delegates
- LINQ pattern detection
- Attributes ([Obsolete])
- XML documentation
- Generics and constraints

### Usage

```typescript
import { CSharpParser } from './parsers/csharp-parser';

const parser = new CSharpParser();
const result = await parser.parseFile('Calculator.cs');
```

### Extracted Data

**Method Structure:**
```typescript
interface CSharpMethod {
  name: string;
  file: string;
  line: number;
  endLine: number;
  visibility: 'public' | 'private' | 'protected' | 'internal';
  static: boolean;
  virtual: boolean;
  override: boolean;
  async: boolean;
  attributes: string[];
  generics: string[];
  parameters: CSharpParameter[];
  returnType: string;
  complexity: number;
  documentation?: string;   // /// XML comments
}
```

**Class Structure:**
```typescript
interface CSharpClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  namespace?: string;
  visibility: 'public' | 'private' | 'protected' | 'internal';
  abstract: boolean;
  sealed: boolean;
  partial: boolean;
  static: boolean;
  attributes: string[];
  generics: string[];
  extends?: string;
  implements?: string[];
  methods: CSharpMethod[];
  properties: CSharpProperty[];
  events: CSharpEvent[];
  documentation?: string;
}

interface CSharpProperty {
  name: string;
  type: string;
  visibility: string;
  hasGetter: boolean;
  hasSetter: boolean;
  autoProperty: boolean;    // { get; set; }
}
```

### Example

```csharp
// Input: Calculator.cs
using System;

namespace MyApp.Math
{
    /// <summary>
    /// Calculator for basic operations
    /// </summary>
    public class Calculator
    {
        public int Result { get; private set; }

        public event EventHandler<int> ResultChanged;

        /// <summary>
        /// Add two numbers
        /// </summary>
        /// <param name="a">First number</param>
        /// <param name="b">Second number</param>
        /// <returns>Sum of a and b</returns>
        [Obsolete("Use AddAsync instead")]
        public int Add(int a, int b)
        {
            Result = a + b;
            ResultChanged?.Invoke(this, Result);
            return Result;
        }

        public async Task<int> AddAsync<T>(T a, T b) where T : struct
        {
            return await Task.FromResult(Convert.ToInt32(a) + Convert.ToInt32(b));
        }
    }
}

// Output:
{
  classes: [{
    name: 'Calculator',
    namespace: 'MyApp.Math',
    visibility: 'public',
    documentation: 'Calculator for basic operations',
    properties: [{
      name: 'Result',
      type: 'int',
      visibility: 'public',
      hasGetter: true,
      hasSetter: true,
      autoProperty: true
    }],
    events: [{
      name: 'ResultChanged',
      type: 'EventHandler<int>',
      visibility: 'public'
    }],
    methods: [{
      name: 'Add',
      visibility: 'public',
      attributes: ['Obsolete("Use AddAsync instead")'],
      parameters: [
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' }
      ],
      returnType: 'int',
      documentation: 'Add two numbers\n<param name="a">First number</param>\n<param name="b">Second number</param>\n<returns>Sum of a and b</returns>',
      complexity: 2
    }, {
      name: 'AddAsync',
      visibility: 'public',
      async: true,
      generics: ['T'],
      parameters: [
        { name: 'a', type: 'T' },
        { name: 'b', type: 'T' }
      ],
      returnType: 'Task<int>',
      complexity: 1
    }]
  }]
}
```

---

## Complexity Calculation

All parsers calculate **cyclomatic complexity** using the same algorithm:

### Formula

```
Complexity = 1 (base) + number of decision points
```

### Decision Points

Each of these adds +1 to complexity:
- `if`, `else if`
- `for`, `while`, `do-while`
- `case` (in switch)
- `catch` (exception handler)
- `&&`, `||` (logical operators)
- `?:` (ternary operator)
- Language-specific: `rescue` (Ruby), `elif` (Python), etc.

### Example

```typescript
// Complexity = 1 (base) + 2 (if) + 1 (&&) = 4
function validate(age: number, name: string): boolean {
  if (age < 0) {
    return false;
  }
  if (age > 120 && name.length === 0) {
    return false;
  }
  return true;
}
```

---

## Error Handling

All parsers implement graceful error handling:

### Parse Errors

```typescript
try {
  const result = await parser.parseFile('invalid.py');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('File not found');
  } else if (error.message.includes('parse')) {
    console.error('Syntax error in file');
  }
}
```

### Fallback Strategies

1. **Python**: Falls back to regex if `ast` module fails
2. **Other languages**: Return partial results on parse errors
3. **Empty files**: Return empty arrays for functions/classes

---

## Performance

### Benchmarks (per 1000 LOC)

| Parser | Parse Time | Memory Usage |
|--------|-----------|--------------|
| TypeScript | ~50ms | ~10MB |
| Python (ast) | ~100ms | ~15MB |
| Python (regex) | ~30ms | ~5MB |
| Java | ~80ms | ~12MB |
| Go | ~60ms | ~10MB |
| Rust | ~70ms | ~11MB |
| Ruby | ~65ms | ~10MB |
| PHP | ~75ms | ~11MB |
| C# | ~85ms | ~13MB |

### Optimization Tips

1. **Cache parsed results** - Use `ai-cache.ts` for repeated parses
2. **Parse incrementally** - Only parse changed files
3. **Use regex fallback** - For quick scans (less accurate)

---

## Integration Examples

### Example 1: Extract All Functions

```typescript
import { PythonParser } from './parsers/python-parser';
import { JavaParser } from './parsers/java-parser';
import * as path from 'path';

async function extractFunctions(filePath: string) {
  const ext = path.extname(filePath);
  let parser;

  switch (ext) {
    case '.py':
      parser = new PythonParser();
      break;
    case '.java':
      parser = new JavaParser();
      break;
    default:
      throw new Error(`Unsupported language: ${ext}`);
  }

  const result = await parser.parseFile(filePath);
  return result.functions;
}

// Usage
const functions = await extractFunctions('calculator.py');
console.log(`Found ${functions.length} functions`);
functions.forEach(fn => {
  console.log(`- ${fn.name} (complexity: ${fn.complexity})`);
});
```

### Example 2: Calculate Total Complexity

```typescript
async function calculateProjectComplexity(files: string[]) {
  let totalComplexity = 0;

  for (const file of files) {
    const parser = getParserForFile(file);
    const result = await parser.parseFile(file);
    totalComplexity += result.complexity;
  }

  return totalComplexity;
}
```

### Example 3: Find High-Complexity Functions

```typescript
async function findComplexFunctions(threshold: number = 10) {
  const parsers = [
    new PythonParser(),
    new JavaParser(),
    new GoParser()
  ];

  const complexFunctions = [];

  for (const file of allFiles) {
    const parser = getParserForFile(file);
    const result = await parser.parseFile(file);

    const complex = result.functions.filter(
      fn => fn.complexity >= threshold
    );

    complexFunctions.push(...complex);
  }

  return complexFunctions;
}
```

---

## Testing

All parsers have comprehensive test coverage:

```bash
# Run parser tests
npm test -- parsers

# Test specific parser
npm test -- python-parser.test
npm test -- java-parser.test
```

### Test Coverage

| Parser | Test Cases | Coverage |
|--------|-----------|----------|
| TypeScript | 25 | 95% |
| Python | 30 | 90% |
| Java | 28 | 88% |
| Go | 26 | 87% |
| Rust | 27 | 86% |
| Ruby | 25 | 85% |
| PHP | 26 | 84% |
| C# | 29 | 89% |

---

## Future Enhancements

### Planned Features

1. **More Languages**
   - Kotlin
   - Swift
   - Scala
   - Elixir

2. **Enhanced Analysis**
   - Control flow graphs
   - Data flow analysis
   - Dead code detection
   - Unused import detection

3. **Performance**
   - Parallel parsing
   - Incremental parsing
   - AST caching

---

## Troubleshooting

### Common Issues

**1. Python parser fails with "Python not found"**

```bash
# Install Python 3.6+
brew install python3  # macOS
sudo apt install python3  # Linux

# Or use regex fallback (automatic)
```

**2. Parse errors with complex code**

```typescript
// Some edge cases may not be parsed correctly
// File an issue with example code:
// https://github.com/ntanwir10/GuardScan/issues
```

**3. Slow parsing on large files**

```typescript
// Use streaming or chunking for files >10K LOC
const chunkSize = 1000;
const chunks = splitIntoChunks(code, chunkSize);
const results = await Promise.all(
  chunks.map(chunk => parser.parseCode(chunk, filePath))
);
```

---

## Support

- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Documentation**: https://github.com/ntanwir10/GuardScan/blob/main/README.md
- **Discussions**: https://github.com/ntanwir10/GuardScan/discussions

---

**Last Updated:** 2025-11-16
**Version:** 1.0.0
**Maintainer:** GuardScan Team
