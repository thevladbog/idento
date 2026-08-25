-- Russify the plan rows seeded in English by seed.go's pre-2026-08-25
-- defaults, and move the two paid tiers to ruble prices (the system is
-- single-currency; the numbers now mean rubles — see
-- docs/superpowers/specs/2026-08-25-ruble-plans-design.md).
--
-- Every UPDATE is guarded by the OLD default value in addition to the slug:
-- a plan the operator already renamed/repriced through the console's plan
-- editor is theirs and must not be clobbered. Name/description and price
-- updates are independent so a partial customization keeps the rest.

UPDATE subscription_plans SET name = 'Бесплатный' WHERE slug = 'free' AND name = 'Free';
UPDATE subscription_plans SET name = 'Стартовый' WHERE slug = 'starter' AND name = 'Starter';
UPDATE subscription_plans SET name = 'Профессиональный' WHERE slug = 'pro' AND name = 'Professional';
UPDATE subscription_plans SET name = 'Корпоративный' WHERE slug = 'enterprise' AND name = 'Enterprise';
UPDATE subscription_plans SET name = 'Безлимитный' WHERE slug = 'unlimited' AND name = 'Unlimited';

UPDATE subscription_plans SET description = 'Для небольших мероприятий и знакомства с сервисом' WHERE slug = 'free' AND description = 'For small events and testing';
UPDATE subscription_plans SET description = 'Для растущих организаций' WHERE slug = 'starter' AND description = 'For growing organizations';
UPDATE subscription_plans SET description = 'Для профессиональных организаторов мероприятий' WHERE slug = 'pro' AND description = 'For professional event organizers';
UPDATE subscription_plans SET description = 'Индивидуальное решение для крупных организаций' WHERE slug = 'enterprise' AND description = 'Custom solution for large organizations';
UPDATE subscription_plans SET description = 'Безлимитный тариф для самостоятельного развёртывания' WHERE slug = 'unlimited' AND description = 'Self-hosted unlimited plan';

-- Deliberately conservative: both old price columns must match the seed
-- defaults before either is touched. If an operator already customized only
-- one of the two price fields, this guard leaves both untouched rather than
-- repricing just the other one — a safe failure direction that avoids a
-- partial, inconsistent reprice.
UPDATE subscription_plans SET price_monthly = 2990, price_yearly = 29900 WHERE slug = 'starter' AND price_monthly = 29 AND price_yearly = 290;
UPDATE subscription_plans SET price_monthly = 9990, price_yearly = 99900 WHERE slug = 'pro' AND price_monthly = 99 AND price_yearly = 990;
