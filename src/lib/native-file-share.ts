// jsPDF's doc.save() and the classic createObjectURL + <a download> pattern
// both rely on the browser's download manager, which doesn't exist inside a
// Capacitor WebView — a click on such a link is silently swallowed there.
// This is the shared save/share step for every blob-download flow in the
// app (PDF export, JSON data export, letter/wrapped share cards): on native
// it writes the blob to disk and opens the native share sheet: on web it
// keeps the exact download flow that already worked.
import { Capacitor } from "@capacitor/core"
import { Filesystem, Directory } from "@capacitor/filesystem"
import { Share } from "@capacitor/share"

export type SavedVia = "share" | "download"

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "")
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function downloadBlobOnWeb(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function saveAndShareBlob(blob: Blob, filename: string, shareTitle?: string): Promise<SavedVia> {
  if (!Capacitor.isNativePlatform()) {
    downloadBlobOnWeb(blob, filename)
    return "download"
  }

  const data = await blobToBase64(blob)
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
  // The file is already saved at this point — Share.share() only opens the
  // native chooser sheet. Backing out of that sheet without picking an app
  // rejects the promise, but that's a cancellation, not a real failure, so
  // it shouldn't surface as one to callers.
  try {
    await Share.share({ files: [uri], title: shareTitle })
  } catch {
    // ignored — user dismissed the share sheet
  }
  return "share"
}
