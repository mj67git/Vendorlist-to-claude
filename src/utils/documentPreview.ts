export interface PreviewableDocument {
  fileName?: string;
  fileDataUrl?: string;
  nameEn?: string;
}

function applyPreviewDocumentStyles(document: Document): void {
  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  document.body.style.background = '#0f172a';
  document.body.style.display = 'flex';
  document.body.style.alignItems = 'center';
  document.body.style.justifyContent = 'center';
  document.body.style.height = '100%';
  document.body.style.color = '#fff';
  document.body.style.fontFamily = 'sans-serif';
}

/**
 * Opens the same image/iframe preview as the legacy implementation without
 * interpolating user-controlled filenames into an HTML string.
 */
export function openDocumentPreview(
  previewDocument: PreviewableDocument,
  onPopupBlocked: () => void,
): void {
  if (!previewDocument.fileDataUrl) return;

  const previewWindow = window.open('', '_blank');
  if (!previewWindow) {
    onPopupBlocked();
    return;
  }

  previewWindow.opener = null;
  const targetDocument = previewWindow.document;
  targetDocument.title = previewDocument.fileName || 'SOP Document';
  applyPreviewDocumentStyles(targetDocument);

  if (previewDocument.fileDataUrl.startsWith('data:image/')) {
    const image = targetDocument.createElement('img');
    image.src = previewDocument.fileDataUrl;
    image.alt = previewDocument.fileName || 'SOP Document';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '100vh';
    image.style.objectFit = 'contain';
    targetDocument.body.appendChild(image);
    return;
  }

  const frame = targetDocument.createElement('iframe');
  frame.src = previewDocument.fileDataUrl;
  frame.title = previewDocument.fileName || 'SOP Document';
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.width = '100%';
  frame.style.height = '100vh';
  frame.style.border = 'none';
  targetDocument.body.appendChild(frame);
}
