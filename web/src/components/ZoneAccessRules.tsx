import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, ShieldX, Save, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import type { ZoneAccessRule } from '@/types';

interface ZoneAccessRulesProps {
  zoneId: string;
  eventId: string;
}

export function ZoneAccessRules({ zoneId, eventId }: ZoneAccessRulesProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [rules, setRules] = useState<Map<string, boolean>>(new Map());
  const [originalRules, setOriginalRules] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when zoneId/eventId change
  }, [zoneId, eventId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all attendees to extract unique categories
      const attendeesResponse = await api.get(`/api/events/${eventId}/attendees`);
      const attendees = attendeesResponse.data;

      // Extract unique categories from custom_fields
      const uniqueCategories = new Set<string>();
      attendees.forEach((attendee: { custom_fields?: { category?: string } }) => {
        if (attendee.custom_fields?.category) {
          uniqueCategories.add(attendee.custom_fields.category);
        }
      });
      const categoriesList = Array.from(uniqueCategories).sort();
      setCategories(categoriesList);

      // Load existing access rules
      const rulesResponse = await api.get<ZoneAccessRule[]>(`/api/zones/${zoneId}/access-rules`);
      const existingRules = rulesResponse.data;

      // Create map of category -> allowed
      const rulesMap = new Map<string, boolean>();
      existingRules.forEach(rule => {
        rulesMap.set(rule.category, rule.allowed);
      });

      setRules(new Map(rulesMap));
      setOriginalRules(new Map(rulesMap));
    } catch (error) {
      console.error('Failed to load access rules:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (category: string, allowed: boolean) => {
    const newRules = new Map(rules);
    newRules.set(category, allowed);
    setRules(newRules);
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Convert map to array of rules
      const rulesArray = Array.from(rules.entries()).map(([category, allowed]) => ({
        category,
        allowed,
      }));

      await api.put(`/api/zones/${zoneId}/access-rules`, rulesArray);

      toast.success(t('accessRulesSaved'));

      // Update original rules to match current state
      setOriginalRules(new Map(rules));
    } catch (error) {
      console.error('Failed to save access rules:', error);
      toast.error(t('failedToSaveAccessRules'));
    } finally {
      setSaving(false);
    }
  };

  const handleAllowAll = () => {
    const newRules = new Map(rules);
    categories.forEach(category => {
      newRules.set(category, true);
    });
    setRules(newRules);
  };

  const handleDenyAll = () => {
    const newRules = new Map(rules);
    categories.forEach(category => {
      newRules.set(category, false);
    });
    setRules(newRules);
  };

  const handleClearAll = () => {
    setRules(new Map());
  };

  const hasChanges = () => {
    if (rules.size !== originalRules.size) return true;
    for (const [category, allowed] of rules.entries()) {
      if (originalRules.get(category) !== allowed) return true;
    }
    return false;
  };

  const getAllowedCount = () => {
    return Array.from(rules.values()).filter(allowed => allowed).length;
  };

  const getDeniedCount = () => {
    return Array.from(rules.values()).filter(allowed => !allowed).length;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          {t('loading')}
        </CardContent>
      </Card>
    );
  }

  if (categories.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('accessRules')}</CardTitle>
          <CardDescription>{t('categoryAccess')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('noCategoriesFound')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('accessRules')}</CardTitle>
            <CardDescription>{t('categoryAccess')}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3 text-green-500" />
              {getAllowedCount()} {t('allowed')}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <ShieldX className="h-3 w-3 text-red-500" />
              {getDeniedCount()} {t('denied')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Info Alert */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('accessRulesInfo')}
            </AlertDescription>
          </Alert>

          {/* Bulk Actions */}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAllowAll}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {t('allowAll')}
            </Button>
            <Button size="sm" variant="outline" onClick={handleDenyAll}>
              <ShieldX className="mr-2 h-4 w-4" />
              {t('denyAll')}
            </Button>
            <Button size="sm" variant="outline" onClick={handleClearAll}>
              {t('clearAll')}
            </Button>
          </div>

          {/* Categories List */}
          <div className="space-y-2">
            {categories.map(category => {
              const isAllowed = rules.get(category);
              const hasRule = isAllowed !== undefined;

              return (
                <div
                  key={category}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {hasRule ? (
                        isAllowed ? (
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                        ) : (
                          <ShieldX className="h-4 w-4 text-red-500" />
                        )
                      ) : (
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Label htmlFor={`category-${category}`} className="cursor-pointer font-medium">
                        {category}
                      </Label>
                    </div>
                    {!hasRule && (
                      <Badge variant="outline" className="text-xs">
                        {t('defaultAllow')}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    {hasRule && (
                      <span className="text-sm text-muted-foreground">
                        {isAllowed ? t('allowed') : t('denied')}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{t('deny')}</span>
                      <Switch
                        id={`category-${category}`}
                        checked={isAllowed !== false}
                        onCheckedChange={(checked) => handleToggle(category, checked)}
                      />
                      <span className="text-sm text-muted-foreground">{t('allow')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save Button */}
          {hasChanges() && (
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={loadData}>
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

