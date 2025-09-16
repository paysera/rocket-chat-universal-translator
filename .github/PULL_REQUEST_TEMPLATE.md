## 📋 Pull Request Checklist

### Type of Change
- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 Documentation update
- [ ] 🎨 Code style update (formatting, renaming)
- [ ] ♻️ Refactoring (no functional changes)
- [ ] ⚡ Performance improvements
- [ ] ✅ Test additions or updates
- [ ] 🔧 Build/CI related changes

### Description
<!-- Describe your changes in detail -->

### Related Issues
<!-- Link any related issues, e.g., "Closes #123" or "Fixes #456" -->

### Screenshots (if applicable)
<!-- Add screenshots to help explain your changes -->

### Testing
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] I have tested this change in a local environment
- [ ] Integration tests pass locally

### Code Quality
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors

### CI/CD Pipeline
- [ ] All automated checks pass (will be verified by CI)
- [ ] Pre-commit hooks pass locally
- [ ] Docker builds succeed locally
- [ ] No security vulnerabilities introduced

### Deployment Considerations
- [ ] This change requires database migrations
- [ ] This change requires environment variable updates
- [ ] This change affects the API contract
- [ ] This change requires configuration updates
- [ ] This change is backward compatible

### Additional Notes
<!-- Any additional information that reviewers should know -->

---

### For Reviewers

#### Review Checklist
- [ ] Code quality and style
- [ ] Test coverage and quality
- [ ] Security implications
- [ ] Performance impact
- [ ] Documentation accuracy
- [ ] Deployment safety

#### Testing Instructions
<!-- Specific instructions for testing this PR -->

1. Checkout the branch
2. Run `npm install` if dependencies changed
3. Run tests: `npm run test:ci`
4. Test manually: [provide specific steps]

#### Deployment Notes
<!-- Any special considerations for deployment -->

---

**Note**: This PR will trigger automated CI/CD pipeline that includes:
- ✅ Code quality checks (ESLint, Prettier, TypeScript)
- ✅ Security scanning (npm audit, Snyk, Trivy)
- ✅ Automated testing (unit, integration, E2E)
- ✅ Docker image building and scanning
- ✅ Performance testing (if targeting main branch)

The pipeline must pass before this PR can be merged.