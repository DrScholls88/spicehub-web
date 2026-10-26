import UIKit
import UniformTypeIdentifiers

/// "Share -> SpiceHub" on iOS.
///
/// iOS cannot hand shared content straight to a WebView app, so this extension
/// writes it to the App Group that @capgo/capacitor-share-target reads, then
/// opens the main app. The plugin emits `shareReceived` (src/main.jsx) on that
/// open, or the next time SpiceHub comes to the foreground if the open is blocked.
/// Text/URL only, matching the Android intent filter and the web share_target.
final class ShareViewController: UIViewController {
    // Must match capacitor.config.json -> plugins.CapacitorShareTarget.appGroupId
    // and the App Groups capability on BOTH the App and ShareExtension targets.
    private let appGroupId = "group.com.spicehub.app"
    // Must match CFBundleURLTypes in App/Info.plist. The plugin listens for host "share".
    private let hostAppURL = URL(string: "com.spicehub.app://share")!

    override func viewDidLoad() {
        super.viewDidLoad()
        Task { await forwardShare() }
    }

    private func forwardShare() async {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        var texts: [String] = []

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    texts.append(url.absoluteString)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    texts.append(text)
                }
            }
            // Some apps put the caption in the item text instead of an attachment.
            if let caption = item.attributedContentText?.string, !caption.isEmpty, !texts.contains(caption) {
                texts.append(caption)
            }
        }

        if !texts.isEmpty {
            let payload: [String: Any] = [
                "title": items.first?.attributedTitle?.string ?? "",
                "texts": texts,
                "files": [[String: Any]](),
            ]
            UserDefaults(suiteName: appGroupId)?.set(payload, forKey: "share-target-data")
            openHostApp()
        }
        extensionContext?.completeRequest(returningItems: nil)
    }

    /// Walks the responder chain to the host UIApplication. If Xcode reports
    /// `open(_:options:completionHandler:)` as unavailable in extensions, set
    /// "Require Only App-Extension-Safe API" to No on the ShareExtension target.
    private func openHostApp() {
        var responder: UIResponder? = self
        while let current = responder {
            if let app = current as? UIApplication {
                app.open(hostAppURL, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }
}
