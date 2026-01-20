import React, { useState, useRef } from 'react';
import { Upload, Scissors, Link2, Download, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export default function FileSplitter() {
  const [mode, setMode] = useState<string>('split');
  const [file, setFile] = useState<File | null>(null);
  const [splitMode, setSplitMode] = useState<string>('pieces');
  const [numPieces, setNumPieces] = useState<string | number>(3);
  const [pieceSize, setPieceSize] = useState<string | number>(1);
  const [sizeUnit, setSizeUnit] = useState<string>('MB');
  const [processing, setProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<any>(null);
  const [joinFiles, setJoinFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const joinInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleJoinFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setJoinFiles(files.sort((a, b) => a.name.localeCompare(b.name)));
      setResult(null);
    }
  };

  const generateKey = () => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const xorEncrypt = (data: Uint8Array, key: string) => {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ key.charCodeAt(i % key.length);
    }
    return result;
  };

  const splitFile = async () => {
    if (!file) return;
    
    setProcessing(true);
    setResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      const key = generateKey();
      
      let chunkSize: number;
      let totalPieces: number;

      if (splitMode === 'pieces') {
        totalPieces = Math.max(2, typeof numPieces === 'string' ? parseInt(numPieces) : numPieces);
        chunkSize = Math.ceil(data.length / totalPieces);
      } else {
        const unitMultiplier: Record<string, number> = {
          'KB': 1024,
          'MB': 1024 * 1024,
          'GB': 1024 * 1024 * 1024
        };
        const size = typeof pieceSize === 'string' ? parseFloat(pieceSize) : pieceSize;
        chunkSize = Math.max(1024, size * unitMultiplier[sizeUnit]);
        totalPieces = Math.ceil(data.length / chunkSize);
      }

      const pieces = [];
      const originalName = file.name;
      const extension = originalName.substring(originalName.lastIndexOf('.')) || '';
      const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;

      for (let i = 0; i < totalPieces; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, data.length);
        const chunk = data.slice(start, end);
        const encrypted = xorEncrypt(chunk, key);
        
        const metadata = {
          originalName,
          totalPieces,
          pieceIndex: i,
          totalSize: data.length,
          key: i === 0 ? key : undefined
        };
        
        const metadataStr = JSON.stringify(metadata);
        const metadataBytes = new TextEncoder().encode(metadataStr);
        const metadataLength = new Uint32Array([metadataBytes.length]);
        
        const pieceData = new Uint8Array(4 + metadataBytes.length + encrypted.length);
        pieceData.set(new Uint8Array(metadataLength.buffer), 0);
        pieceData.set(metadataBytes, 4);
        pieceData.set(encrypted, 4 + metadataBytes.length);
        
        const blob = new Blob([pieceData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        pieces.push({
          name: `${baseName}.part${(i + 1).toString().padStart(3, '0')}${extension}`,
          url,
          size: blob.size
        });
      }

      setResult({
        type: 'split',
        pieces,
        originalSize: file.size,
        totalPieces: pieces.length
      });
    } catch (error: any) {
      alert('Error splitting file: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleJoinFiles = async () => {
    if (joinFiles.length === 0) return;
    
    setProcessing(true);
    setResult(null);

    try {
      const parts: { index: number; data: Uint8Array }[] = [];
      let key = null;
      let metadata = null;

      for (const file of joinFiles) {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        
        const metadataLength = new Uint32Array(data.slice(0, 4).buffer)[0];
        const metadataBytes = data.slice(4, 4 + metadataLength);
        const metadataStr = new TextDecoder().decode(metadataBytes);
        const pieceMetadata = JSON.parse(metadataStr);
        
        if (pieceMetadata.key) {
          key = pieceMetadata.key;
        }
        
        if (!metadata) {
          metadata = pieceMetadata;
        }
        
        const encryptedData = data.slice(4 + metadataLength);
        parts.push({ index: pieceMetadata.pieceIndex, data: encryptedData });
      }

      if (!key) {
        throw new Error('Master key not found. Missing first piece.');
      }

      if (parts.length !== metadata.totalPieces) {
        throw new Error(`Missing pieces. Found ${parts.length} of ${metadata.totalPieces}.`);
      }

      parts.sort((a, b) => a.index - b.index);
      
      const decrypted = [];
      for (const part of parts) {
        const decryptedChunk = xorEncrypt(part.data, key);
        decrypted.push(decryptedChunk);
      }

      const totalLength = decrypted.reduce((sum, arr) => sum + arr.length, 0);
      const joined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of decrypted) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }

      const blob = new Blob([joined]);
      const url = URL.createObjectURL(blob);

      setResult({
        type: 'join',
        name: metadata.originalName,
        url,
        size: blob.size
      });
    } catch (error: any) {
      alert('Error joining files: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const downloadAll = () => {
    result.pieces.forEach((piece: any, index: number) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = piece.url;
        a.download = piece.name;
        a.click();
      }, index * 100);
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-slate-100">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Scissors className="w-10 h-10 text-purple-400" />
            File Splitter & Joiner
          </h1>
          <p className="text-purple-200">Split files securely and join them back seamlessly</p>
        </div>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <div className="flex gap-4 mb-8">
            <button
              onClick={() => { setMode('split'); setResult(null); }}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                mode === 'split'
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/50'
                  : 'bg-white/5 text-purple-200 hover:bg-white/10'
              }`}
            >
              <Scissors className="w-5 h-5" />
              Split File
            </button>
            <button
              onClick={() => { setMode('join'); setResult(null); }}
              className={`flex-1 py-3 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                mode === 'join'
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/50'
                  : 'bg-white/5 text-purple-200 hover:bg-white/10'
              }`}
            >
              <Link2 className="w-5 h-5" />
              Join Files
            </button>
          </div>

          {mode === 'split' ? (
            <div className="space-y-6">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-purple-400/50 rounded-xl p-12 text-center cursor-pointer hover:border-purple-400 hover:bg-white/5 transition-all"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Upload className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                {file ? (
                  <div>
                    <p className="text-white font-semibold mb-1">{file.name}</p>
                    <p className="text-purple-300 text-sm">{formatSize(file.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-white font-semibold mb-1">Click to select file</p>
                    <p className="text-purple-300 text-sm">Any file type supported</p>
                  </div>
                )}
              </div>

              <div className="bg-white/5 rounded-xl p-6 space-y-4">
                <div className="flex gap-4">
                  <button
                    onClick={() => setSplitMode('pieces')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                      splitMode === 'pieces'
                        ? 'bg-purple-500 text-white'
                        : 'bg-white/5 text-purple-200 hover:bg-white/10'
                    }`}
                  >
                    By Number of Pieces
                  </button>
                  <button
                    onClick={() => setSplitMode('size')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                      splitMode === 'size'
                        ? 'bg-purple-500 text-white'
                        : 'bg-white/5 text-purple-200 hover:bg-white/10'
                    }`}
                  >
                    By Piece Size
                  </button>
                </div>

                {splitMode === 'pieces' ? (
                  <div>
                    <label className="block text-purple-200 mb-2 font-medium">Number of Pieces</label>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={numPieces}
                      onChange={(e) => setNumPieces(e.target.value)}
                      className="w-full bg-white/10 border border-purple-400/30 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20"
                    />
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-purple-200 mb-2 font-medium">Piece Size</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={pieceSize}
                        onChange={(e) => setPieceSize(e.target.value)}
                        className="w-full bg-white/10 border border-purple-400/30 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20"
                      />
                    </div>
                    <div className="w-32">
                      <label className="block text-purple-200 mb-2 font-medium">Unit</label>
                      <select
                        value={sizeUnit}
                        onChange={(e) => setSizeUnit(e.target.value)}
                        className="w-full bg-white/10 border border-purple-400/30 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20"
                      >
                        <option value="KB">KB</option>
                        <option value="MB">MB</option>
                        <option value="GB">GB</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={splitFile}
                disabled={!file || processing}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Scissors className="w-5 h-5" />
                    Split File
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div
                onClick={() => joinInputRef.current?.click()}
                className="border-2 border-dashed border-purple-400/50 rounded-xl p-12 text-center cursor-pointer hover:border-purple-400 hover:bg-white/5 transition-all"
              >
                <input
                  ref={joinInputRef}
                  type="file"
                  multiple
                  onChange={handleJoinFilesSelect}
                  className="hidden"
                />
                <FileText className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                {joinFiles.length > 0 ? (
                  <div>
                    <p className="text-white font-semibold mb-1">{joinFiles.length} files selected</p>
                    <p className="text-purple-300 text-sm">Ready to join</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-white font-semibold mb-1">Click to select split files</p>
                    <p className="text-purple-300 text-sm">Select all parts to join</p>
                  </div>
                )}
              </div>

              {joinFiles.length > 0 && (
                <div className="bg-white/5 rounded-xl p-4 max-h-48 overflow-y-auto">
                  {joinFiles.map((f, i) => (
                    <div key={i} className="text-purple-200 text-sm py-1 px-2 hover:bg-white/5 rounded">
                      {f.name}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleJoinFiles}
                disabled={joinFiles.length === 0 || processing}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Link2 className="w-5 h-5" />
                    Join Files
                  </>
                )}
              </button>
            </div>
          )}

          {result && (
            <div className="mt-8 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/30 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
                <h3 className="text-xl font-bold text-white">
                  {result.type === 'split' ? 'File Split Successfully!' : 'Files Joined Successfully!'}
                </h3>
              </div>

              {result.type === 'split' ? (
                <div className="space-y-4">
                  <div className="text-purple-200">
                    <p>Original size: <span className="text-white font-semibold">{formatSize(result.originalSize)}</span></p>
                    <p>Total pieces: <span className="text-white font-semibold">{result.totalPieces}</span></p>
                  </div>
                  
                  <button
                    onClick={downloadAll}
                    className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download All Pieces
                  </button>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {result.pieces.map((piece: any, i: number) => (
                      <a
                        key={i}
                        href={piece.url}
                        download={piece.name}
                        className="flex items-center justify-between bg-white/5 hover:bg-white/10 p-3 rounded-lg transition-all"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-purple-400" />
                          <span className="text-white text-sm">{piece.name}</span>
                        </div>
                        <span className="text-purple-300 text-sm">{formatSize(piece.size)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-purple-200">
                    <p>File name: <span className="text-white font-semibold">{result.name}</span></p>
                    <p>File size: <span className="text-white font-semibold">{formatSize(result.size)}</span></p>
                  </div>
                  
                  <a
                    href={result.url}
                    download={result.name}
                    className="block w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg font-semibold transition-all text-center"
                  >
                    <Download className="w-5 h-5 inline mr-2" />
                    Download Joined File
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-500/10 border border-blue-400/30 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-blue-200 text-sm">
            <p className="font-semibold mb-1">How it works:</p>
            <p>Split files are encrypted with a unique key stored in the first piece. All pieces must be present to reconstruct the original file. This ensures security during transfer or storage.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
