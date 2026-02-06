import { useState } from 'react';
import { Upload } from 'lucide-react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
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
import api from '@/lib/api';

interface CSVRow {
  first_name: string;
  last_name: string;
  email?: string;
  company?: string;
  position?: string;
  code?: string;
}

interface CSVImportProps {
  eventId: string;
  onImportComplete: () => void;
}

export function CSVImport({ eventId, onImportComplete }: CSVImportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [csvData, setCSVData] = useState<CSVRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as CSVRow[];
        
        // Validate required fields
        const validData = data.filter(row => row.first_name && row.last_name);
        
        if (validData.length === 0) {
          setError('No valid rows found. CSV must have "first_name" and "last_name" columns.');
          return;
        }
        
        setCSVData(validData);
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      }
    });
  };

  const handleImport = async () => {
    setIsImporting(true);
    setError(null);
    
    try {
      await api.post(`/api/events/${eventId}/attendees/bulk`, {
        attendees: csvData
      });
      
      setIsOpen(false);
      setCSVData([]);
      onImportComplete();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(msg || 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setCSVData([]);
    setError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleClose();
      else setIsOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Attendees from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with columns: first_name, last_name, email, company, position, code (optional)
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-primary file:text-primary-foreground
                hover:file:bg-primary/90"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          {csvData.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Found {csvData.length} attendee(s) to import:
              </p>
              <div className="border rounded-md max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>First Name</TableHead>
                      <TableHead>Last Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvData.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>{row.first_name}</TableCell>
                        <TableCell>{row.last_name}</TableCell>
                        <TableCell>{row.email || '-'}</TableCell>
                        <TableCell>{row.company || '-'}</TableCell>
                        <TableCell>{row.position || '-'}</TableCell>
                        <TableCell>{row.code || 'Auto'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={csvData.length === 0 || isImporting}
          >
            {isImporting ? 'Importing...' : `Import ${csvData.length} Attendee(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

