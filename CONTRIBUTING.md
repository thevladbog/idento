# Contributing to Idento

Thank you for your interest in contributing to Idento!

## Important Note

Idento uses a **proprietary license** (All Rights Reserved). This means:
- You cannot use, modify, or distribute the code without explicit written permission
- The project is developed as a commercial SaaS product
- Public contributions are accepted only with the understanding that contributed code becomes property of the project owner

## Before Contributing

Please note that by submitting a contribution (pull request, issue, suggestion), you agree that:
1. Your contribution will be licensed under the same proprietary license as the project
2. You grant the project owner full rights to use, modify, and commercialize your contribution
3. You have the right to submit the contribution (it's your original work)

## How to Contribute

### Reporting Bugs

Found a bug? Please [open an issue](https://github.com/thevladbog/idento/issues/new/choose) with:

1. **Clear title** - Brief description of the issue
2. **Environment** - OS, browser, Go/Node versions
3. **Steps to reproduce** - How to trigger the bug
4. **Expected behavior** - What should happen
5. **Actual behavior** - What actually happens
6. **Screenshots/logs** - Visual proof or error logs
7. **Additional context** - Any other relevant information

### Suggesting Features

Have an idea? Please [open an issue](https://github.com/thevladbog/idento/issues/new/choose) with:

1. **Clear description** - What feature you want
2. **Use case** - Why this feature is needed
3. **Proposed solution** - How it could work (optional)
4. **Alternatives** - Other approaches you've considered (optional)
5. **Additional context** - Screenshots, mockups, examples

### Submitting Pull Requests

**Note:** Due to the proprietary nature of this project, we may not accept all pull requests. Please discuss significant changes in an issue first.

If you want to submit a PR:

1. **Fork the repository**
2. **Create a feature branch** - `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Follow code style** - See style guides below
5. **Test your changes** - Run `make test` and `make lint`
6. **Commit** - Use clear commit messages (see below)
7. **Push** - `git push origin feature/amazing-feature`
8. **Open a Pull Request** - Use the PR template

## Development Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions for your platform (Windows, macOS, Linux).

Quick setup:
```bash
# Clone and setup
git clone https://github.com/thevladbog/idento.git
cd idento

# Start development environment
make dev  # or platform-specific script
```

## Code Style

### Go (Backend & Agent)

Follow the project's Go style rules in `.cursor/rules/go-backend.mdc`:

- Use `gofmt` and `goimports`
- Run `make lint` before committing
- Write tests for new features
- Handle errors explicitly
- Use meaningful variable names
- Keep functions small and focused

**Example:**
```go
// Good
func GetAttendeeByCode(ctx context.Context, code string) (*Attendee, error) {
    if code == "" {
        return nil, fmt.Errorf("code cannot be empty")
    }
    // ... implementation
}

// Bad
func get(c string) *Attendee {
    // ... no error handling, unclear name
}
```

### TypeScript (Web)

Follow the project's TypeScript/React rules:

- Use `npm run lint` before committing
- Use functional components with hooks
- Use TypeScript types (avoid `any`)
- Use meaningful component and variable names
- Keep components small and reusable

**Example:**
```typescript
// Good
interface AttendeeCardProps {
  attendee: Attendee;
  onCheckIn: (id: string) => Promise<void>;
}

export function AttendeeCard({ attendee, onCheckIn }: AttendeeCardProps) {
  // ... implementation
}

// Bad
export function Card(props: any) {
  // ... unclear props, using any
}
```

### Kotlin (Mobile)

Follow the project's Kotlin/Android rules in `.cursor/rules/android.mdc`:

- Use clean architecture patterns
- Use MVI for state management
- Write meaningful test cases
- Use proper naming conventions
- Keep classes small and focused

## Commit Messages

Use clear, descriptive commit messages:

```
type(scope): brief description

Detailed explanation if needed

Fixes #123
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or tooling changes

**Examples:**
```
feat(backend): add zone-based check-in filtering
fix(web): correct CSV import preview rendering
docs(readme): update cross-platform setup instructions
```

## Testing

Before submitting:

```bash
# Run all tests
make test

# Run with coverage
make test-coverage

# Lint all code
make lint

# Build to verify compilation
make build-all
```

## Pull Request Process

1. **Update documentation** - If you changed functionality
2. **Add tests** - For new features or bug fixes
3. **Update CHANGELOG** - If there's one (not currently in project)
4. **Run CI locally** - `make lint && make test && make build-all`
5. **Request review** - Tag maintainers if needed
6. **Address feedback** - Respond to review comments

## Code Review

All submissions require review. We will:
- Check code quality and style
- Verify tests pass
- Ensure documentation is updated
- Validate the change aligns with project goals

## Questions?

- Open an [issue](https://github.com/thevladbog/idento/issues/new/choose)
- Check [DEVELOPMENT.md](DEVELOPMENT.md) for setup help
- Review [existing issues](https://github.com/thevladbog/idento/issues)

## License

By contributing, you agree that your contributions will be subject to the same proprietary license as the project. See [LICENSE](LICENSE) for details.

---

Thank you for contributing to Idento! 🎉
