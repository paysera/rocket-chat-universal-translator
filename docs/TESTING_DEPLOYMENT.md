# 🧪 Testing Strategy & Deployment Guide

## Testing Strategy

### 1. Development Setup

#### Local Rocket.Chat Instance
```bash
# Start local development environment
cd /opt/dev/rocket-chat-universal-translator
docker-compose -f docker-compose.dev.yml up -d

# Access Rocket.Chat
# URL: http://localhost:3000
# Admin: admin / admin123
```

#### Plugin Development Environment
```bash
# Install Rocket.Chat Apps CLI
npm install -g @rocket.chat/apps-cli

# Create plugin development workspace
rc-apps create universal-translator-pro
cd universal-translator-pro

# Install dependencies
npm install

# Link to local Rocket.Chat for development
rc-apps deploy --url http://localhost:3000 --username admin --password admin123
```

### 2. Test Languages & Scenarios

#### Primary Test Languages
1. **English (en)** - Base language, high-quality AI translation
2. **Lithuanian (lt)** - Native language, complex grammar
3. **Russian (ru)** - Cyrillic script, different language family

#### Test Scenarios Matrix
```typescript
interface TestScenario {
  sourceLanguage: string;
  targetLanguage: string;
  testCases: {
    simple: string[];      // Short phrases, common words
    technical: string[];   // Technical terminology, business terms
    contextual: string[];  // Requires conversation context
    edge: string[];        // Edge cases, mixed languages
  };
}

const testScenarios: TestScenario[] = [
  {
    sourceLanguage: 'lt',
    targetLanguage: 'en',
    testCases: {
      simple: [
        'Labas rytas',
        'Kaip sekasi?',
        'Ačiū už pagalbą',
        'Iki pasimatymo'
      ],
      technical: [
        'Reikia pataisyti duomenų bazės klaidą',
        'API endpoint neatsakinėja',
        'Deployment sėkmingas',
        'Code review baigtas'
      ],
      contextual: [
        'Jis yra geras programuotojas',    // 'He' context needed
        'Ši funkcija neveikia',            // 'This' context needed
        'Taip, sutinku su tavimi',         // Previous agreement context
        'Ne, geriau kitaip'                // Previous suggestion context
      ],
      edge: [
        'Hello, labas rytas!',             // Mixed languages
        'API reikia pataisyti ASAP',       // Acronyms + Lithuanian
        '€100 už translation service',     // Currency + English + Lithuanian
        'git commit -m "pirmasis testas"'  // Code + Lithuanian
      ]
    }
  },
  {
    sourceLanguage: 'en',
    targetLanguage: 'lt',
    testCases: {
      simple: [
        'Good morning',
        'How are you?',
        'Thank you for help',
        'See you later'
      ],
      technical: [
        'Need to fix database error',
        'API endpoint not responding',
        'Deployment successful',
        'Code review completed'
      ],
      contextual: [
        'He is a good programmer',
        'This function is not working',
        'Yes, I agree with you',
        'No, let\'s do it differently'
      ],
      edge: [
        'Labas, good morning!',
        'Reikia fix this API',
        '€100 for translation service',
        'git commit -m "first test"'
      ]
    }
  },
  {
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    testCases: {
      simple: [
        'Доброе утро',
        'Как дела?',
        'Спасибо за помощь',
        'До встречи'
      ],
      technical: [
        'Нужно исправить ошибку базы данных',
        'API не отвечает',
        'Деплой успешный',
        'Code review завершен'
      ],
      contextual: [
        'Он хороший программист',
        'Эта функция не работает',
        'Да, я согласен с тобой',
        'Нет, лучше по-другому'
      ],
      edge: [
        'Привет, good morning!',
        'Нужно fix этот API',
        '€100 за translation сервис',
        'git commit -m "первый тест"'
      ]
    }
  }
];
```

### 3. Automated Testing

#### Unit Tests
```typescript
// Plugin unit tests
describe('Universal Translator Plugin', () => {
  describe('Language Detection', () => {
    test('should detect Lithuanian correctly', async () => {
      const result = await detectLanguage('Labas rytas, kaip sekasi?');
      expect(result.language).toBe('lt');
      expect(result.confidence).toBeGreaterThan(0.9);
    });
    
    test('should detect mixed language content', async () => {
      const result = await detectLanguage('Hello, labas rytas!');
      expect(result.language).toBe('en'); // Primary language
      expect(result.mixed).toBe(true);
    });
  });

  describe('Translation Service', () => {
    test('should translate simple Lithuanian to English', async () => {
      const result = await translateText('Labas rytas', 'lt', 'en');
      expect(result.translated_text.toLowerCase()).toContain('good morning');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    test('should handle context for better translations', async () => {
      const context = [
        { user: 'Jonas', text: 'Ar turi laiko?' },
        { user: 'Petras', text: 'Taip, turiu.' }
      ];
      
      const result = await translateTextWithContext(
        'Jis užimtas',  // "He is busy" - context determines who "he" is
        'lt',
        'en',
        context
      );
      
      expect(result.translated_text.toLowerCase()).toMatch(/(he|jonas) is busy/);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce per-user rate limits', async () => {
      const userId = 'test-user-123';
      const requests = Array(101).fill(null).map(() => 
        translateForUser('Hello', userId, 'en', 'lt')
      );
      
      const results = await Promise.allSettled(requests);
      const rejected = results.filter(r => r.status === 'rejected');
      
      expect(rejected.length).toBeGreaterThan(0);
    });
  });
});
```

#### Integration Tests
```typescript
describe('Rocket.Chat Integration', () => {
  test('should intercept messages and translate', async () => {
    const mockMessage = {
      id: 'msg-123',
      text: 'Labas rytas visiems!',
      user: { id: 'user-lt', language: 'lt' },
      room: { id: 'room-123' }
    };
    
    const recipients = [
      { id: 'user-en', language: 'en' },
      { id: 'user-ru', language: 'ru' }
    ];
    
    const results = await processMessageTranslation(mockMessage, recipients);
    
    expect(results).toHaveLength(2);
    expect(results[0].translated_text).toContain('Good morning');
    expect(results[1].translated_text).toContain('Доброе утро');
  });

  test('should show translation indicators in UI', async () => {
    // This requires E2E testing with actual Rocket.Chat instance
    const page = await browser.newPage();
    await page.goto('http://localhost:3000');
    
    // Login and navigate to test channel
    await loginAsUser(page, 'testuser', 'password');
    await navigateToChannel(page, 'test-translation');
    
    // Send message in Lithuanian
    await sendMessage(page, 'Labas rytas!');
    
    // Verify translation indicator appears
    const indicator = await page.waitForSelector('.translation-indicator');
    expect(indicator).toBeTruthy();
    
    // Verify hover shows original text
    await page.hover('.translated-message');
    const tooltip = await page.waitForSelector('.original-text-tooltip');
    expect(await tooltip.textContent()).toContain('Labas rytas!');
  });
});
```

### 4. Manual Testing Checklist

#### Installation & Configuration
- [ ] Plugin installs successfully from marketplace
- [ ] 3 EUR credits are automatically applied
- [ ] Admin can configure API keys (fallback method)
- [ ] Settings panel accessible in Admin → Apps
- [ ] User preferences accessible in Settings → Preferences

#### Real-Time Translation
- [ ] Lithuanian message translates to English for English user
- [ ] English message translates to Lithuanian for Lithuanian user  
- [ ] Russian message translates correctly to both English and Lithuanian
- [ ] Same language detection prevents unnecessary translation
- [ ] Translation indicator (🌍) appears on translated messages
- [ ] Hover shows original text in tooltip
- [ ] Long press (mobile) shows original text popup

#### Historical Translation
- [ ] Translation icon (🌍) appears at end of old messages
- [ ] Clicking icon translates message for current user
- [ ] Translation is cached for all users after first translation
- [ ] Toggle between original and translated view works

#### Context Awareness
- [ ] Pronouns (he/she/it) translated correctly with context
- [ ] Technical terms preserved based on conversation context
- [ ] Business terminology translated appropriately
- [ ] Username mentions not translated

#### Permission & Channel Management
- [ ] Admin can enable/disable translation per channel
- [ ] Users with "manage-translation" permission can control channels
- [ ] Private channels inherit workspace settings
- [ ] Bot messages follow channel translation settings

#### Rate Limiting & Error Handling
- [ ] High-volume translation requests are rate-limited
- [ ] API failure shows cached translations when available
- [ ] No error messages shown to users when API is down
- [ ] Translation works normally after API recovery

#### Analytics & Billing
- [ ] Admin dashboard shows token usage by user
- [ ] Channel-level token consumption visible to admins
- [ ] Real-time user activity (who has translation enabled)
- [ ] No cost information visible to end users

### 5. Performance Testing

#### Load Testing Scenarios
```bash
# Simulate high translation volume
k6 run --vus 50 --duration 5m translation-load-test.js

# Test concurrent users in same channel
k6 run --vus 100 --duration 2m concurrent-channel-test.js

# Test API timeout scenarios
k6 run --vus 10 --duration 10m timeout-test.js
```

#### Performance Criteria
- **Translation Speed**: <2s for 95% of requests
- **Context Processing**: <500ms additional time for context
- **Cache Hit Rate**: >80% for repeated translations
- **Memory Usage**: <100MB per 1000 active users
- **Database Queries**: <5 queries per translation request

### 6. Deployment Testing

#### Development → Staging
```bash
# Deploy to staging Rocket.Chat instance
rc-apps deploy --url https://staging-chat.paysera.com --username admin

# Run automated test suite
npm run test:integration

# Verify plugin functionality
npm run test:e2e
```

#### Staging → Production (chat.paysera.com)
```bash
# Final deployment to production
rc-apps deploy --url https://chat.paysera.com --username admin

# Monitor for errors
tail -f /var/log/rocketchat/apps.log | grep universal-translator

# Verify billing integration
curl -X POST https://chat.paysera.com/api/v1/analytics/usage \
  -H "Authorization: Bearer admin-token"
```

### 7. Rollback Strategy

#### Plugin Rollback
```bash
# Rollback to previous version via marketplace
rc-apps deploy --url https://chat.paysera.com --previous-version

# Or disable plugin if issues persist
rc-apps disable universal-translator-pro --url https://chat.paysera.com
```

#### API Service Rollback
```bash
# Rollback translation API service
cd /opt/prod/services/context-aware-translator
git checkout previous-stable-tag
docker-compose build && docker-compose up -d

# Verify health
curl https://translator.noreika.lt/health
```

### 8. Monitoring & Alerting

#### Key Metrics to Monitor
- **Translation Success Rate**: Should be >95%
- **Average Response Time**: Should be <3 seconds
- **API Error Rate**: Should be <1%
- **User Adoption**: % of users with translation enabled
- **Token Usage**: Cost per workspace per day

#### Alert Conditions
- Translation error rate >5% for 5 minutes
- Average response time >10 seconds for 2 minutes
- API service health check fails 3 consecutive times
- Daily token usage >10x workspace average

### 9. User Acceptance Testing

#### Test Users & Roles
1. **Admin User**: Can configure all settings, view analytics
2. **Channel Manager**: Has "manage-translation" permission  
3. **Regular Users**: Different language preferences (EN, LT, RU)
4. **Mobile Users**: Test mobile app functionality

#### Acceptance Criteria
- [ ] Users can communicate naturally in their preferred language
- [ ] Translation quality is acceptable for business communication
- [ ] Setup requires minimal configuration (out-of-the-box)
- [ ] Performance impact on Rocket.Chat is negligible
- [ ] Billing integration works transparently

---

**Testing Owner**: QA Team & Engineering  
**Test Environment**: Local Development → Staging → Production  
**Deployment Schedule**: After all tests pass successfully