'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { importApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { useAuthStore } from '../../../store/authStore';
import { Badge, Spinner } from '../../../components/ui';
import { Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

const TARGET_FIELDS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Company Name',
  'Industry',
  'Country',
  'Lead Source',
  'Sub Source',
  'Requirement Type',
  'Budget Range',
  'Notes',
];

export default function ImportPage() {
  const permissions = usePermissions();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'insert' | 'update' | 'upsert'>('upsert');
  const [ownerMode, setOwnerMode] = useState<'single' | 'round_robin'>('single');
  const [assignedToId, setAssignedToId] = useState('');
  const [results, setResults] = useState<any>(null);
  const [errors, setErrors] = useState<any[]>([]);

  const { data: usersData } = useQuery({
    queryKey: ['import-users'],
    queryFn: () => usersApi.list().then((r) => r.data?.data ?? r.data ?? []),
    enabled: permissions.canImportData,
  });
  const users = Array.isArray(usersData) ? usersData : [];

  const ownerCandidates = useMemo(() => {
    if (permissions.isManager && user?.id) {
      return users.filter((u: any) => u.managerId === user.id || u.id === user.id);
    }
    return users;
  }, [users, permissions.isManager, user?.id]);

  const importMutation = useMutation({
    mutationFn: (formData: FormData) => importApi.importLeads(formData),
    onSuccess: (response) => {
      const data = response.data?.data ?? response.data ?? {};
      setResults({
        totalRecords: data.totalRecords ?? data.total ?? 0,
        imported: data.imported ?? data.success ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
      });
      setErrors(Array.isArray(data.errors) ? data.errors : []);
      toast.success('Import completed');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Import failed';
      const details = error.response?.data?.errors;
      setErrors(Array.isArray(details) ? details : [{ message }]);
      toast.error(message);
    }
  });

  const parseCsvText = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return { parsedHeaders: [], parsedRows: [] };
    const parsedHeaders = lines[0].split(',').map((item) => item.trim());
    const parsedRows = lines.slice(1, 6).map((line) => line.split(',').map((item) => item.trim()));
    return { parsedHeaders, parsedRows };
  };

  const handleFileSelect = async (selectedFile: File) => {
    const isCsv = selectedFile.name.toLowerCase().endsWith('.csv');
    const isXlsx = selectedFile.name.toLowerCase().endsWith('.xlsx');

    if (!isCsv && !isXlsx) {
      toast.error('Only .csv and .xlsx are supported');
      return;
    }

    setFile(selectedFile);
    setResults(null);
    setErrors([]);

    if (isCsv) {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const { parsedHeaders, parsedRows } = parseCsvText(text);
        setHeaders(parsedHeaders);
        setRows(parsedRows);
      };
      reader.readAsText(selectedFile);
      return;
    }

    try {
      const xlsxLib = (window as any).XLSX;
      if (!xlsxLib) {
        throw new Error('xlsx not present');
      }
      const buffer = await selectedFile.arrayBuffer();
      const workbook = xlsxLib.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetRows = xlsxLib.utils.sheet_to_json(firstSheet, { header: 1 }) as any[];
      const parsedHeaders = Array.isArray(sheetRows[0]) ? sheetRows[0].map((h: any) => String(h || '').trim()) : [];
      const parsedRows = sheetRows.slice(1, 6).map((row: any[]) => row.map((cell: any) => String(cell ?? '')));
      setHeaders(parsedHeaders);
      setRows(parsedRows);
    } catch {
      setHeaders([]);
      setRows([]);
      toast('xlsx package is not available, file stored without preview parsing');
    }
  };

  const handleImport = () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    const normalizedMapping: Record<string, string> = {};
    Object.entries(columnMapping).forEach(([source, target]) => {
      if (target && target !== 'Skip') {
        normalizedMapping[source] = target;
      }
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    formData.append('columnMapping', JSON.stringify(normalizedMapping));
    if (ownerMode === 'single' && assignedToId) {
      formData.append('assignedToId', assignedToId);
    }
    formData.append('roundRobin', ownerMode === 'round_robin' ? 'true' : 'false');

    importMutation.mutate(formData);
  };

  const downloadErrorReport = () => {
    if (!errors.length) return;
    const blob = new Blob([JSON.stringify(errors, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!permissions.canImportData) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Unauthorized</h1>
        <p className="text-sm text-slate-500 mt-1">You do not have permission to import data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="page-title">Import Data</h1>
        <p className="text-sm text-slate-500 mt-1">3-step import wizard for lead uploads</p>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 text-xs">
          {[
            'Step 1: Upload File',
            'Step 2: Map Columns',
            'Step 3: Configure & Import',
          ].map((item, idx) => (
            <div
              key={item}
              className={`px-2.5 py-1 rounded-md border ${step === idx + 1 ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-500'}`}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">Step 1: Upload File</h2>
          <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-300 dark:border-white/[0.1] rounded-xl cursor-pointer hover:border-blue-500/40 transition-colors bg-slate-100 dark:bg-slate-950">
            <Upload size={30} className="text-slate-500 mb-2" />
            <p className="text-sm text-slate-600 dark:text-slate-300">Click to upload CSV/XLSX</p>
            <input
              type="file"
              className="hidden"
              accept=".csv,.xlsx"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) handleFileSelect(selected);
              }}
            />
          </label>
          {file && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-200">
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </div>
          )}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!file} onClick={() => setStep(2)}>Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">Step 2: Map Columns</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Source Column</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-500">Target Lead Field</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-slate-200 dark:border-white/[0.04]">
                    <td className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{header}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input h-8 text-xs"
                        title="Map column to target field"
                        value={columnMapping[header] || 'Skip'}
                        onChange={(e) => setColumnMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                      >
                        <option value="Skip">Skip</option>
                        {TARGET_FIELDS.map((field) => (
                          <option key={field} value={field}>{field}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {headers.length === 0 && <p className="text-sm text-slate-500 py-4">No headers detected.</p>}
          </div>
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary" onClick={() => setStep(3)} disabled={!file}>Next</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card p-6 space-y-5">
          <h2 className="section-title">Step 3: Configure & Import</h2>

          <div>
            <label className="label mb-2 block">Mode</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { value: 'insert', label: 'Insert Only' },
                { value: 'update', label: 'Update Existing' },
                { value: 'upsert', label: 'Upsert Recommended' },
              ].map((m) => (
                <label key={m.value} className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === m.value} onChange={() => setMode(m.value as any)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label mb-2 block">Owner Assignment</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="radio" checked={ownerMode === 'single'} onChange={() => setOwnerMode('single')} />
                Assign All to One Person
              </label>
              {ownerMode === 'single' && (
                <select className="input" title="Assign all records to user" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                  <option value="">Select user</option>
                  {ownerCandidates.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="radio" checked={ownerMode === 'round_robin'} onChange={() => setOwnerMode('round_robin')} />
                Round-Robin Auto-Distribution
              </label>
            </div>
          </div>

          <div>
            <h3 className="label mb-2 block">Preview (first 5 rows)</h3>
            <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-200 dark:border-white/[0.04]">
                      {headers.map((_, hidx) => (
                        <td key={hidx} className="px-3 py-2 text-xs text-slate-400">{row[hidx] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="text-sm text-slate-500 p-4">No preview available.</p>}
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" onClick={handleImport} disabled={importMutation.isPending || !file}>
              {importMutation.isPending ? <><Spinner size={14} /> Importing...</> : 'Import'}
            </button>
          </div>
        </div>
      )}

      {(results || errors.length > 0) && (
        <div className="card p-6 space-y-3">
          <h2 className="section-title">Import Results</h2>
          {results && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Badge color="blue">Total Records: {results.totalRecords}</Badge>
              <Badge color="green">Imported: {results.imported}</Badge>
              <Badge color="amber">Skipped: {results.skipped}</Badge>
              <Badge color="red">Failed: {results.failed}</Badge>
            </div>
          )}
          {errors.length > 0 && (
            <div>
              <p className="text-sm text-red-400 mb-2">Errors</p>
              <ul className="space-y-1">
                {errors.slice(0, 10).map((err: any, idx: number) => (
                  <li key={idx} className="text-xs text-slate-400">{err.message || JSON.stringify(err)}</li>
                ))}
              </ul>
              <button className="btn-ghost mt-3" onClick={downloadErrorReport}>
                <Download size={14} /> Download Error Report
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
