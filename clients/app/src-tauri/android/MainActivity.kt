package cloud.synergytech.suite

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

// Replaces the MainActivity that `tauri android init` generates; `npm run android:init`
// copies it into src-tauri/gen/android.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // No edge-to-edge drawing: suite pages are ordinary web pages and expect to sit below the
    // status bar, not under it.
    super.onCreate(savedInstanceState)
    // Back goes back a page, and from the first page sends the app to the background like a
    // browser does. Closing the activity instead tears the app down and crashes it.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else moveTaskToBack(true)
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
  }
}
