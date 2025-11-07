# Contributing to GuardScan

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 18+
- Git
- A code editor (VS Code recommended)

### Local Development

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/ai-code-review.git
cd ai-code-review
```

2. **Install dependencies**

```bash
# CLI
cd cli
npm install

# Backend
cd ../backend
npm install
```

3. **Set up environment variables**

```bash
# CLI
cd cli
cp .env.example .env
# Edit .env with your API keys

# Backend
cd ../backend
cp .env.example .env
# Edit .env with your credentials
```

4. **Build and test**

```bash
# CLI
cd cli
npm run build
npm link  # Makes guardscan command available globally

# Test
guardscan --help
```

## Project Structure

```
ai-code-review/
├── cli/                  # CLI application
│   ├── src/
│   │   ├── commands/    # CLI commands
│   │   ├── core/        # Core functionality
│   │   ├── providers/   # AI provider implementations
│   │   └── utils/       # Utility functions
│   └── package.json
├── backend/             # Cloudflare Workers API
│   ├── src/
│   │   ├── handlers/    # API endpoint handlers
│   │   ├── db.ts        # Database layer
│   │   └── index.ts     # Worker entry point
│   └── package.json
├── docs/                # Documentation
└── README.md
```

## Code Style

- **TypeScript**: Use strict mode
- **Formatting**: Consistent indentation (2 spaces)
- **Naming**:
  - camelCase for variables and functions
  - PascalCase for classes and types
  - UPPER_CASE for constants
- **Comments**: Use JSDoc for public APIs

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Your Changes

- Write clean, readable code
- Add tests for new features
- Update documentation as needed
- Follow existing code style

### 3. Test Your Changes

```bash
# Build
npm run build

# Test locally
guardscan init
guardscan config
guardscan run
```

### 4. Commit Your Changes

Use descriptive commit messages:

```bash
git commit -m "feat: add support for new AI provider"
git commit -m "fix: resolve LOC counting issue for Python"
git commit -m "docs: update installation instructions"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear description of changes
- Reference to any related issues
- Screenshots (if UI changes)
- Test results

## Adding New Features

### Adding a New AI Provider

1. Create provider class in `cli/src/providers/`:

```typescript
import { AIProvider, AIMessage, AIResponse } from './base';

export class NewProvider extends AIProvider {
  // Implement required methods
}
```

2. Register in `cli/src/providers/factory.ts`
3. Add configuration support in `cli/src/commands/config.ts`
4. Update documentation

### Adding a New Command

1. Create command file in `cli/src/commands/your-command.ts`
2. Implement command function
3. Register in `cli/src/index.ts`
4. Add tests
5. Update README

### Adding New Security Rules

1. Add pattern to `cli/src/commands/security.ts`
2. Categorize by severity
3. Provide clear descriptions and suggestions
4. Test with sample code

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Lint code
npm run lint
```

## Documentation

- Update README.md for user-facing changes
- Update docs/ for technical documentation
- Include code examples where appropriate
- Keep API documentation up to date

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Build and test
5. Publish to NPM
6. Create GitHub release

## Getting Help

- Open an issue for bugs or feature requests
- Join our Discord community (link)
- Email: support@guardscan.dev

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Follow the project's code of conduct

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
