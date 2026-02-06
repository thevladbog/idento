import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Papa from 'papaparse';
import api from '@/lib/api';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

interface CSVImportEnhancedProps {
  eventId: string;
  onImportComplete: () => void;
}

interface DuplicateInfo {
  email: string;
  code?: string;
  first_name: string;
  last_name: string;
  reason: string;
}

interface ImportResult {
  message: string;
  created: number;
  skipped: number;
  total: number;
  duplicates?: DuplicateInfo[];
}

export function CSVImportEnhanced({ eventId, onImportComplete }: CSVImportEnhancedProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCSVData] = useState<Record<string, string>[]>([]);
  const [fieldSchema, setFieldSchema] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCodeColumn, setHasCodeColumn] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const selectedFile = event.target.files[0];
      setFile(selectedFile);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCSVData((results.data || []) as Record<string, string>[]);
        
        // Extract field names
        if (results.meta && results.meta.fields) {
          const fields = results.meta.fields;
          setFieldSchema(fields);
          
          // Check if code column exists
          const hasCode = fields.some(f => f.toLowerCase() === 'code');
          setHasCodeColumn(hasCode);
        }
        setError(null);
      },
      error: (error: Error) => {
        setError(t('csvParseError') + ': ' + error.message);
      }
    });
  };

  const handleImport = async () => {
    if (csvData.length === 0) {
      setError(t('noDataToImport'));
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const response = await api.post<ImportResult>(`/api/events/${eventId}/attendees/bulk`, {
        attendees: csvData,
        field_schema: fieldSchema
      });

      setImportResult(response.data);
      setShowResult(true);
      onImportComplete();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(msg || t('importFailed'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setShowResult(false);
    setImportResult(null);
    setCSVData([]);
    setFieldSchema([]);
    setFile(null);
    setError(null);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) handleClose();
        else setIsOpen(true);
      }}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" /> {t('importCsv')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('importAttendees')}</DialogTitle>
            <DialogDescription>
              {t('uploadCsvDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            {/* File Upload */}
            <div className="grid gap-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="csvFile" className="text-right">
                  {t('csvFile')}
                </Label>
                <div className="col-span-3">
                  {!file ? (
                    <Input id="csvFile" type="file" accept=".csv" onChange={handleFileChange} />
                  ) : (
                    <div className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                      <div className="flex items-center">
                        <FileSpreadsheet className="w-5 h-5 mr-2 text-primary" />
                        <span className="font-medium">{file.name}</span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setFile(null);
                          setCSVData([]);
                          setFieldSchema([]);
                          setError(null);
                        }}
                      >
                        {t('change')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
                <AlertCircle className="w-4 h-4" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* Field Schema Display */}
            {fieldSchema.length > 0 && (
              <div className="border rounded-md p-4">
                <h4 className="font-semibold mb-2">{t('detectedFields')}:</h4>
                <div className="flex flex-wrap gap-2">
                  {fieldSchema.map((field) => (
                    <span key={field} className="px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                      {field}
                    </span>
                  ))}
                </div>
              {!hasCodeColumn && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-300 dark:border-yellow-700 rounded-md">
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    ⚠️ {t('noCodeColumnDetected')}
                  </p>
                </div>
              )}
              </div>
            )}

            {/* Data Preview */}
            {csvData.length > 0 && !showResult && (
              <div className="border rounded-md">
                <div className="p-3 bg-muted/50 border-b">
                  <h4 className="font-semibold">{t('dataPreview')} ({csvData.length} {t('rows')})</h4>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {fieldSchema.map((field) => (
                          <TableHead key={field}>{field}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvData.slice(0, 10).map((row, idx) => (
                        <TableRow key={idx}>
                          {fieldSchema.map((field) => (
                            <TableCell key={field}>{row[field] || '-'}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {csvData.length > 10 && (
                    <div className="p-2 text-center text-sm text-muted-foreground border-t">
                      {t('showingFirst10')} ({csvData.length} {t('total')})
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>{t('cancel')}</Button>
            {csvData.length > 0 && !showResult && (
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? t('importing') : t('import')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      {importResult && (
        <Dialog open={showResult} onOpenChange={(open) => {
          if (!open) {
            setShowResult(false);
            handleClose();
          }
        }}>
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{t('importResults')}</DialogTitle>
              <DialogDescription>
                {t('importResultsDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 overflow-y-auto flex-1 pr-2">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-700">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <span className="font-semibold text-green-800 dark:text-green-200">{t('created')}</span>
                  </div>
                  <div className="text-3xl font-bold text-green-900 dark:text-green-100">{importResult.created}</div>
                </div>

                <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-950/50 border-yellow-200 dark:border-yellow-700">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <span className="font-semibold text-yellow-800 dark:text-yellow-200">{t('skipped')}</span>
                  </div>
                  <div className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{importResult.skipped}</div>
                </div>

                <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-700">
                  <div className="flex items-center gap-2 mb-2">
                    <FileSpreadsheet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <span className="font-semibold text-blue-800 dark:text-blue-200">{t('totalAttendees')}</span>
                  </div>
                  <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{importResult.total}</div>
                </div>
              </div>

              {/* Duplicates List */}
              {importResult.duplicates && importResult.duplicates.length > 0 && (
                <div className="border rounded-md">
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border-b">
                    <h4 className="font-semibold text-yellow-900 dark:text-yellow-100">
                      {t('duplicatesFound')} ({importResult.duplicates.length})
                    </h4>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                      {t('duplicatesDescription')}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('attendeeName')}</TableHead>
                          <TableHead>{t('email')}</TableHead>
                          <TableHead>{t('code')}</TableHead>
                          <TableHead>{t('reason')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.duplicates.map((dup, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{dup.first_name} {dup.last_name}</TableCell>
                            <TableCell>{dup.email}</TableCell>
                            <TableCell>
                              <code className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-2 py-1 rounded font-mono">
                                {dup.code || '-'}
                              </code>
                            </TableCell>
                            <TableCell>
                              {dup.reason === 'email' ? t('duplicateEmail') : t('duplicateCode')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {importResult.skipped === 0 && (
                <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100 rounded-md">
                  <CheckCircle2 className="w-5 h-5" />
                  <p className="font-medium">{t('allRecordsImported')}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => {
                setShowResult(false);
                handleClose();
              }}>
                {t('close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
