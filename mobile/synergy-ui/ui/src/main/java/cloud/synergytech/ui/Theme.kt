package cloud.synergytech.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

/** Light / Dark / follow-the-system, matching the web apps' own control. */
enum class ThemeMode { LIGHT, DARK, AUTO }

val SynergyShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

/**
 * Every role is set explicitly, and that is the point.
 *
 * Material 3 fills any role you omit from its own baseline palette, which is
 * purple. SynergyPhone's keypad was drawing in `secondaryContainer` — a role an
 * earlier version of this file didn't set — so the app stayed purple even after
 * adopting the theme. A partial scheme leaks; only a complete one is safe.
 */
private val DarkColors = darkColorScheme(
    primary = Sky500,
    onPrimary = Slate950,
    primaryContainer = Sky700,
    onPrimaryContainer = Sky300,
    inversePrimary = Sky600,

    secondary = Sky400,
    onSecondary = Slate950,
    secondaryContainer = Slate800,
    onSecondaryContainer = Slate100,

    tertiary = Sky300,
    onTertiary = Slate950,
    tertiaryContainer = Slate800,
    onTertiaryContainer = Sky300,

    background = Slate950,
    onBackground = Slate100,

    surface = Slate900,
    onSurface = Slate100,
    surfaceVariant = Slate800,
    onSurfaceVariant = Slate400,
    surfaceTint = Sky500,
    inverseSurface = Slate100,
    inverseOnSurface = Slate900,

    surfaceDim = Slate950,
    surfaceBright = Slate700,
    surfaceContainerLowest = Slate950,
    surfaceContainerLow = Slate900,
    surfaceContainer = Slate800,
    surfaceContainerHigh = Slate700,
    surfaceContainerHighest = Slate600,

    error = Red500,
    onError = SynergyWhite,
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFFECACA),

    outline = Slate600,
    outlineVariant = Slate800,
    scrim = Color(0xFF000000),
)

private val LightColors = lightColorScheme(
    primary = Sky600,
    onPrimary = SynergyWhite,
    primaryContainer = Sky300,
    onPrimaryContainer = Sky700,
    inversePrimary = Sky400,

    secondary = Sky700,
    onSecondary = SynergyWhite,
    secondaryContainer = Slate100,
    onSecondaryContainer = Slate900,

    tertiary = Sky600,
    onTertiary = SynergyWhite,
    tertiaryContainer = Slate100,
    onTertiaryContainer = Sky700,

    background = SynergyWhite,
    onBackground = Slate900,

    surface = Slate50,
    onSurface = Slate900,
    surfaceVariant = Slate100,
    onSurfaceVariant = Slate500,
    surfaceTint = Sky600,
    inverseSurface = Slate900,
    inverseOnSurface = Slate100,

    surfaceDim = Slate200,
    surfaceBright = SynergyWhite,
    surfaceContainerLowest = SynergyWhite,
    surfaceContainerLow = Slate50,
    surfaceContainer = Slate100,
    surfaceContainerHigh = Slate200,
    surfaceContainerHighest = Slate300,

    error = Red500,
    onError = SynergyWhite,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),

    outline = Slate400,
    outlineVariant = Slate200,
    scrim = Color(0xFF000000),
)

/**
 * The one theme every Synergy app should wrap its content in.
 *
 * Note there is no `dynamicColor` option, and that is deliberate. Material You
 * dynamic colour is what makes an unthemed app render in the system accent —
 * which is exactly why SynergyPhone currently draws in Android's default purple.
 * Brand beats wallpaper here.
 */
@Composable
fun SynergyTheme(
    mode: ThemeMode = ThemeMode.AUTO,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.AUTO -> isSystemInDarkTheme()
    }
    val colors = if (dark) DarkColors else LightColors

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            // Only the bar ICON colour is set here. The old version of this block
            // also assigned window.statusBarColor / navigationBarColor, which was
            // worse than useless: both are deprecated and are no-ops once the app
            // targets SDK 35, and painting the bars to match the background merely
            // hid the fact that content was drawing underneath them. That is what
            // made every screen look "smashed against the top".
            //
            // Layout insets are deliberately NOT applied here. A blanket padding at
            // theme level would double-pad any screen using Scaffold and would stop
            // deliberate edge-to-edge backgrounds (Weather's gradient hero) from
            // reaching the top of the display. Screens handle it, one of two ways:
            //   - with a Scaffold: apply the innerPadding it hands you
            //   - without one:     wrap the root in SynergyScreen { }
            (view.context as? Activity)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = SynergyTypography,
        shapes = SynergyShapes,
        content = content,
    )
}
