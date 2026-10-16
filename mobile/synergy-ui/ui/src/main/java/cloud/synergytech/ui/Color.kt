package cloud.synergytech.ui

import androidx.compose.ui.graphics.Color

/**
 * The Synergy palette.
 *
 * Lifted from the Weather app rather than invented: that one already mirrors the
 * web properties (Tailwind slate for surfaces and text, sky for the accent), so
 * adopting it here makes the Android fleet match the web instead of introducing a
 * third look. Authenticator's #4F7CFF is a different blue and should move to Sky.
 */

// Accent.
val Sky700 = Color(0xFF0369A1)
val Sky600 = Color(0xFF0284C7)
val Sky500 = Color(0xFF0EA5E9)
val Sky400 = Color(0xFF38BDF8)
val Sky300 = Color(0xFF7DD3FC)

// Neutral ramp. Every surface, border and text colour comes from here so that
// nothing falls back to Material You — which is why three apps currently render
// in Android's default purple.
val Slate950 = Color(0xFF020617)
val Slate900 = Color(0xFF0F172A)
val Slate800 = Color(0xFF1E293B)
val Slate700 = Color(0xFF334155)
val Slate600 = Color(0xFF475569)
val Slate500 = Color(0xFF64748B)
val Slate400 = Color(0xFF94A3B8)
val Slate300 = Color(0xFFCBD5E1)
val Slate200 = Color(0xFFE2E8F0)
val Slate100 = Color(0xFFF1F5F9)
val Slate50 = Color(0xFFF8FAFC)

val SynergyWhite = Color(0xFFFFFFFF)

// Semantic. Used by StatusPill and the error/empty states -- kept deliberately
// small so "which green?" never becomes a per-app decision.
val Emerald500 = Color(0xFF10B981)
val Amber500 = Color(0xFFF59E0B)
val Red500 = Color(0xFFEF4444)
