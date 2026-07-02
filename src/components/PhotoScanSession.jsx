import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Camera, Images, FileText, X as XIcon, Plus } from 'lucide-react';
import { hapticLight, hapticError } from '../haptics';
import { isPdfFile, pdfToPageDataUrls } from '../lib/pdfPages.js';
import { MAX_PAGES } from '../lib/photoImportEngine.js';

// Shared spring easing (matches ImportSheet/ImportInput)
const SPRING = { type: 'spring', stiffness: 380, damping: 30 };

/**
 * PhotoScanSession — scanner-style multi-page capture for photo import.
 *
 * Renders the Photo tab body: a reorderable thumbnail strip of captured
 * pages plus camera / gallery / PDF intake. Page state lives in ImportSheet
 * (needed again at review time for dish-photo re-cropping).
 *
 * Props:
 *   pages             — [{ id, dataUrl, source }]
 *   setPages          — state setter (functional updates supported)
 *   disabled          — true while the pipeline is running
 *   incomingFiles     — File[] dropped/pasted outside the Photo tab
 *   onIncomingHandled — called after incomingFiles are ingested
 */
export default function PhotoScanSession({
  pages,
  setPages,
  disabled = false,
  incomingFiles = null,
  onIncomingHandled,
}) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState('');
  const [notice, setNotice] = useState('');

  const remaining = MAX_PAGES - pages.length;

  const pushPages = useCallback((newOnes) => {
    if (!newOnes.length) return;
    setPages((prev) => {
      const room = MAX_PAGES - prev.length;
      if (room <= 0) return prev;
      if (newOnes.length > room) {
        setNotice(`Only ${MAX_PAGES} pages per scan — kept the first ${MAX_PAGES}.`);
      }
      return [...prev, ...newOnes.slice(0, room)];
    });
  }, [setPages]);

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Accepts a FileList/array of images and/or PDFs from either input.
  const ingestFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setNotice('');
    const collected = [];
    for (const file of files) {
      if (isPdfFile(file)) {
        try {
          setPdfBusy(`Reading ${file.name}…`);
          const { pages: pdfPages, truncated } = await pdfToPageDataUrls(file, {
            maxPages: Math.max(1, remaining - collected.length),
            onProgress: (n, total) => setPdfBusy(`Rendering page ${n} of ${total}…`),
          });
          pdfPages.forEach((dataUrl) => {
            collected.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, source: 'pdf' });
          });
          if (truncated) setNotice(`That PDF is long — imported the first ${MAX_PAGES} pages.`);
        } catch (err) {
          hapticError();
          setNotice(err.message || "Couldn't read that PDF.");
        } finally {
          setPdfBusy('');
        }
      } else if (file.type?.startsWith('image/')) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          collected.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, source: 'gallery' });
        } catch {
          hapticError();
          setNotice(`Couldn't read ${file.name}.`);
        }
      }
    }
    pushPages(collected);
  }, [pushPages, remaining]);

  // Files dropped/pasted outside the Photo tab arrive as a prop.
  useEffect(() => {
    if (incomingFiles?.length) {
      ingestFiles(incomingFiles);
      onIncomingHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles]);

  const handleInputChange = useCallback((e) => {
    const files = e.target.files;
    if (files?.length) {
      hapticLight();
      ingestFiles(files);
    }
    e.target.value = ''; // allow re-selecting the same file
  }, [ingestFiles]);

  const removePage = useCallback((id) => {
    hapticLight();
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, [setPages]);

  return (
    <div className="scan-session">
      {/* Thumbnail strip — appears once the first page lands */}
      <AnimatePresence initial={false}>
        {pages.length > 0 && (
          <motion.div
            key="strip"
            className="scan-strip-wrap"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="scan-strip-head">
              <span className="scan-strip-count">
                {pages.length} page{pages.length === 1 ? '' : 's'}
              </span>
              {pages.length > 1 && <span className="scan-strip-hint">Drag to reorder</span>}
            </div>
            <Reorder.Group
              axis="x"
              values={pages}
              onReorder={setPages}
              className="scan-strip"
              as="div"
            >
              {pages.map((page, i) => (
                <Reorder.Item
                  key={page.id}
                  value={page}
                  as="div"
                  className="scan-thumb"
                  layout
                  transition={SPRING}
                  whileDrag={{ scale: 1.06, zIndex: 2, boxShadow: '0 10px 24px -8px rgba(0,0,0,0.35)' }}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                >
                  <img src={page.dataUrl} alt={`Page ${i + 1}`} draggable={false} />
                  <span className="scan-thumb-num">{i + 1}</span>
                  {!disabled && (
                    <button
                      type="button"
                      className="scan-thumb-remove"
                      onClick={() => removePage(page.id)}
                      aria-label={`Remove page ${i + 1}`}
                    >
                      <XIcon size={13} strokeWidth={2.5} />
                    </button>
                  )}
                </Reorder.Item>
              ))}

              {/* Add-page tile at the end of the strip */}
              {remaining > 0 && !disabled && (
                <motion.button
                  type="button"
                  className="scan-thumb scan-thumb-add"
                  onClick={() => { hapticLight(); cameraRef.current?.click(); }}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Add another page"
                >
                  <Plus size={22} strokeWidth={2} />
                  <span>Add page</span>
                </motion.button>
              )}
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Intake buttons */}
      <div className="import-input-photo-btn-row">
        <button
          type="button"
          className="import-input-photo-btn"
          onClick={() => { hapticLight(); cameraRef.current?.click(); }}
          disabled={disabled || remaining <= 0}
        >
          <Camera size={22} strokeWidth={2} />
          <span>{pages.length ? 'Snap next page' : 'Take Photo'}</span>
        </button>
        <button
          type="button"
          className="import-input-photo-btn"
          onClick={() => { hapticLight(); galleryRef.current?.click(); }}
          disabled={disabled || remaining <= 0}
        >
          <Images size={22} strokeWidth={2} />
          <span>Choose Files</span>
        </button>
      </div>

      <p className="import-input-photo-hint">
        {pages.length === 0 ? (
          <>Cookbook pages, recipe cards, menu boards, screenshots — even a PDF. Add up to {MAX_PAGES} pages, then extract once.</>
        ) : (
          <>Add the back of the card or the next page, or hit <strong>Extract Recipe</strong> below.</>
        )}
      </p>

      {/* PDF progress + notices */}
      <AnimatePresence initial={false}>
        {pdfBusy && (
          <motion.p
            key="pdfbusy"
            className="scan-session-note scan-session-note-busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <FileText size={14} strokeWidth={2} /> {pdfBusy}
          </motion.p>
        )}
        {notice && !pdfBusy && (
          <motion.p
            key="notice"
            className="scan-session-note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
