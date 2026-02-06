import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Copy, Key, Trash2, AlertCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/utils/dateFormat';

interface APIKey {
  id: string;
  event_id: string;
  name: string;
  key_preview: string;
  expires_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  created_at: string;
}

interface APIKeysManagerProps {
  eventId: string;
}

export function APIKeysManager({ eventId }: APIKeysManagerProps) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<{ api_key: APIKey; plain_key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const fetchKeys = async () => {
    try {
      const response = await api.get(`/api/events/${eventId}/api-keys`);
      setKeys(response.data || []);
    } catch (error) {
      console.error('Failed to fetch API keys', error);
      toast.error(t('failedToLoadApiKeys'));
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error(t('apiKeyNameRequired'));
      return;
    }

    setLoading(true);
    try {
      const payload: { name: string; expires_at?: string } = { name: newKeyName };
      if (newKeyExpiry) {
        payload.expires_at = new Date(newKeyExpiry).toISOString();
      }

      const response = await api.post(`/api/events/${eventId}/api-keys`, payload);
      setCreatedKey(response.data);
      setShowCreateDialog(false);
      setShowKeyDialog(true);
      setNewKeyName('');
      setNewKeyExpiry('');
      fetchKeys();
      toast.success(t('apiKeyCreated'));
    } catch (error) {
      console.error('Failed to create API key', error);
      toast.error(t('failedToCreateApiKey'));
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm(t('confirmRevokeApiKey'))) return;

    try {
      await api.delete(`/api/events/${eventId}/api-keys/${keyId}`);
      toast.success(t('apiKeyRevoked'));
      fetchKeys();
    } catch (error) {
      console.error('Failed to revoke API key', error);
      toast.error(t('failedToRevokeApiKey'));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(t('copiedToClipboard'));
    setTimeout(() => setCopied(false), 2000);
  };

  const getApiUrl = () => {
    return `${window.location.origin.replace(':5173', ':8080')}/api/public/import`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {t('apiKeys')}
            </CardTitle>
            <CardDescription>{t('apiKeysDesc')}</CardDescription>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Key className="mr-2 h-4 w-4" />
                {t('createApiKey')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('createApiKey')}</DialogTitle>
                <DialogDescription>{t('createApiKeyDesc')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="key-name">{t('keyName')}</Label>
                  <Input
                    id="key-name"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder={t('keyNamePlaceholder')}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="key-expiry">{t('expiresAt')} ({t('optional')})</Label>
                  <Input
                    id="key-expiry"
                    type="datetime-local"
                    value={newKeyExpiry}
                    onChange={(e) => setNewKeyExpiry(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreateKey} disabled={loading}>
                  {loading ? t('creating') : t('create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('noApiKeysYet')}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('key')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('expiresAt')}</TableHead>
                <TableHead>{t('lastUsed')}</TableHead>
                <TableHead>{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-sm">{key.key_preview}</TableCell>
                  <TableCell>
                    {key.revoked_at ? (
                      <span className="text-destructive">{t('revoked')}</span>
                    ) : key.expires_at && new Date(key.expires_at) < new Date() ? (
                      <span className="text-destructive">{t('expired')}</span>
                    ) : (
                      <span className="text-green-600">{t('active')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {key.expires_at ? formatDateTime(key.expires_at) : t('never')}
                  </TableCell>
                  <TableCell>
                    {key.last_used_at ? formatDateTime(key.last_used_at) : t('neverUsed')}
                  </TableCell>
                  <TableCell>
                    {!key.revoked_at && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevokeKey(key.id)}
                        title={t('revokeKey')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Key Created Dialog with Instructions */}
        <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" />
                {t('apiKeyCreatedTitle')}
              </DialogTitle>
              <DialogDescription>{t('apiKeyCreatedDesc')}</DialogDescription>
            </DialogHeader>
            
            {createdKey && (
              <div className="space-y-3 overflow-y-auto pr-2 py-1">
                {/* Warning */}
                <div className="flex gap-2 p-2.5 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-amber-900 dark:text-amber-100">{t('importantNote')}</p>
                    <p className="text-amber-800 dark:text-amber-200">{t('apiKeyOnlyShownOnce')}</p>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('yourApiKey')}</Label>
                  <div className="flex gap-1.5">
                    <Input
                      value={createdKey.plain_key}
                      readOnly
                      className="font-mono text-xs h-8"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => copyToClipboard(createdKey.plain_key)}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>

                {/* Usage Instructions */}
                <div className="space-y-2.5">
                  <h4 className="font-semibold text-sm">{t('howToUse')}</h4>
                  
                  <div className="space-y-1.5">
                    <Label className="text-xs">1. {t('endpoint')}</Label>
                    <div className="flex gap-1.5">
                      <Input
                        value={getApiUrl()}
                        readOnly
                        className="font-mono text-xs h-8"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyToClipboard(getApiUrl())}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">2. {t('requestFormat')}</Label>
                    <div className="bg-muted p-2 rounded-lg font-mono text-xs overflow-x-auto max-h-48 overflow-y-auto">
                      <pre className="whitespace-pre-wrap break-words text-[10px] leading-tight">{`POST ${getApiUrl()}
Headers:
  Content-Type: application/json
  X-API-Key: ${createdKey.plain_key}

Body:
{
  "data": [
    {
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "company": "Acme Corp",
      "position": "Manager",
      "code": "TICKET001",
      "custom_field": "value"
    }
  ]
}`}</pre>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">3. {t('curlExample')}</Label>
                    <div className="bg-muted p-2 rounded-lg font-mono overflow-x-auto max-h-32 overflow-y-auto">
                      <pre className="whitespace-pre-wrap break-words text-[10px] leading-tight">{`curl -X POST '${getApiUrl()}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${createdKey.plain_key}' \\
  -d '{"data":[{"first_name":"John","last_name":"Doe","email":"john@example.com"}]}'`}</pre>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => copyToClipboard(`curl -X POST '${getApiUrl()}' -H 'Content-Type: application/json' -H 'X-API-Key: ${createdKey.plain_key}' -d '{"data":[{"first_name":"John","last_name":"Doe","email":"john@example.com"}]}'`)}
                    >
                      <Copy className="mr-1.5 h-3 w-3" />
                      {t('copyCurlCommand')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="flex-shrink-0 border-t pt-3 mt-2">
              <Button onClick={() => {
                setShowKeyDialog(false);
                setCreatedKey(null);
              }}>
                {t('close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

