-- Restore the English seed defaults with the same guarded shape (only rows
-- still at the 000028 values are touched).
UPDATE subscription_plans SET name = 'Free' WHERE slug = 'free' AND name = 'Бесплатный';
UPDATE subscription_plans SET name = 'Starter' WHERE slug = 'starter' AND name = 'Стартовый';
UPDATE subscription_plans SET name = 'Professional' WHERE slug = 'pro' AND name = 'Профессиональный';
UPDATE subscription_plans SET name = 'Enterprise' WHERE slug = 'enterprise' AND name = 'Корпоративный';
UPDATE subscription_plans SET name = 'Unlimited' WHERE slug = 'unlimited' AND name = 'Безлимитный';

UPDATE subscription_plans SET description = 'For small events and testing' WHERE slug = 'free' AND description = 'Для небольших мероприятий и знакомства с сервисом';
UPDATE subscription_plans SET description = 'For growing organizations' WHERE slug = 'starter' AND description = 'Для растущих организаций';
UPDATE subscription_plans SET description = 'For professional event organizers' WHERE slug = 'pro' AND description = 'Для профессиональных организаторов мероприятий';
UPDATE subscription_plans SET description = 'Custom solution for large organizations' WHERE slug = 'enterprise' AND description = 'Индивидуальное решение для крупных организаций';
UPDATE subscription_plans SET description = 'Self-hosted unlimited plan' WHERE slug = 'unlimited' AND description = 'Безлимитный тариф для самостоятельного развёртывания';

UPDATE subscription_plans SET price_monthly = 29, price_yearly = 290 WHERE slug = 'starter' AND price_monthly = 2990 AND price_yearly = 29900;
UPDATE subscription_plans SET price_monthly = 99, price_yearly = 990 WHERE slug = 'pro' AND price_monthly = 9990 AND price_yearly = 99900;
