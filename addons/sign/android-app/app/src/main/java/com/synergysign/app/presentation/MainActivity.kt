package com.synergysign.app.presentation

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.synergysign.app.presentation.auth.AuthEvent
import com.synergysign.app.presentation.auth.AuthViewModel
import com.synergysign.app.presentation.auth.LoginScreen
import com.synergysign.app.presentation.auth.SignupScreen
import com.synergysign.app.presentation.dashboard.DashboardScreen
import com.synergysign.app.presentation.dashboard.DashboardViewModel
import com.synergysign.app.presentation.documents.DocumentListScreen
import com.synergysign.app.presentation.documents.DocumentListViewModel
import com.synergysign.app.presentation.signature.SignatureCaptureScreen
import com.synergysign.app.presentation.signature.SignatureViewModel
import com.synergysign.app.presentation.theme.SynergySignTheme
import com.synergysign.app.presentation.upload.UploadScreen
import com.synergysign.app.presentation.upload.UploadViewModel
import com.synergysign.app.presentation.viewer.FieldPlacementScreen
import com.synergysign.app.presentation.viewer.FieldPlacementViewModel
import com.synergysign.app.presentation.viewer.PdfViewerScreen
import com.synergysign.app.presentation.viewer.PdfViewerViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SynergySignTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SynergySignApp()
                }
            }
        }
    }
}

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Signup : Screen("signup")
    object Dashboard : Screen("dashboard")
    object Documents : Screen("documents")
    object DocumentDetail : Screen("document/{documentId}") {
        fun createRoute(documentId: String) = "document/$documentId"
    }
    object Upload : Screen("upload")
    object PdfViewer : Screen("pdf-viewer/{documentId}") {
        fun createRoute(documentId: String) = "pdf-viewer/$documentId"
    }
    object FieldPlacement : Screen("field-placement/{documentId}") {
        fun createRoute(documentId: String) = "field-placement/$documentId"
    }
    object SignatureCapture : Screen("signature/{documentId}/{fieldId}") {
        fun createRoute(documentId: String, fieldId: String) = "signature/$documentId/$fieldId"
    }
}

@Composable
fun SynergySignApp(
    navController: NavHostController = rememberNavController(),
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val authState by authViewModel.state.collectAsState()

    // Determine start destination based on auth state
    val startDestination = if (authState.isAuthenticated) {
        Screen.Dashboard.route
    } else {
        Screen.Login.route
    }

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        // Login Screen
        composable(Screen.Login.route) {
            LoginScreen(
                state = authState,
                onLogin = { email, password ->
                    authViewModel.onEvent(AuthEvent.Login(email, password))
                },
                onNavigateToSignup = {
                    navController.navigate(Screen.Signup.route)
                },
                onClearError = {
                    authViewModel.onEvent(AuthEvent.ClearError)
                }
            )

            // Navigate to dashboard on successful login
            if (authState.isAuthenticated) {
                navController.navigate(Screen.Dashboard.route) {
                    popUpTo(Screen.Login.route) { inclusive = true }
                }
            }
        }

        // Signup Screen
        composable(Screen.Signup.route) {
            SignupScreen(
                state = authState,
                onSignup = { email, password, firstName, lastName, companyName ->
                    authViewModel.onEvent(
                        AuthEvent.Signup(email, password, firstName, lastName, companyName)
                    )
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                },
                onClearError = {
                    authViewModel.onEvent(AuthEvent.ClearError)
                }
            )

            // Navigate to dashboard on successful signup
            if (authState.isAuthenticated) {
                navController.navigate(Screen.Dashboard.route) {
                    popUpTo(Screen.Login.route) { inclusive = true }
                }
            }
        }

        // Dashboard Screen
        composable(Screen.Dashboard.route) {
            val dashboardViewModel: DashboardViewModel = hiltViewModel()
            val dashboardState by dashboardViewModel.state.collectAsState()

            DashboardScreen(
                state = dashboardState,
                userName = authState.user?.name ?: authState.user?.email,
                onRefresh = { dashboardViewModel.refresh() },
                onDocumentClick = { documentId ->
                    navController.navigate(Screen.PdfViewer.createRoute(documentId))
                },
                onViewAllDocuments = {
                    navController.navigate(Screen.Documents.route)
                },
                onUploadDocument = {
                    navController.navigate(Screen.Upload.route)
                },
                onLogout = {
                    authViewModel.onEvent(AuthEvent.Logout)
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        // Documents List Screen
        composable(Screen.Documents.route) {
            val documentsViewModel: DocumentListViewModel = hiltViewModel()
            val documentsState by documentsViewModel.state.collectAsState()

            DocumentListScreen(
                state = documentsState,
                onRefresh = { documentsViewModel.refresh() },
                onLoadMore = { documentsViewModel.loadMore() },
                onDocumentClick = { documentId ->
                    navController.navigate(Screen.PdfViewer.createRoute(documentId))
                },
                onStatusFilter = { status ->
                    documentsViewModel.setStatusFilter(status)
                },
                onSearch = { query ->
                    documentsViewModel.setSearchQuery(query)
                },
                onBack = {
                    navController.popBackStack()
                },
                onUpload = {
                    navController.navigate(Screen.Upload.route)
                }
            )
        }

        // Upload Screen
        composable(Screen.Upload.route) {
            val uploadViewModel: UploadViewModel = hiltViewModel()
            val uploadState by uploadViewModel.state.collectAsState()

            UploadScreen(
                state = uploadState,
                onSelectFile = { uri -> uploadViewModel.selectFile(uri) },
                onTitleChange = { uploadViewModel.setTitle(it) },
                onDescriptionChange = { uploadViewModel.setDescription(it) },
                onUpload = { uploadViewModel.upload() },
                onBack = { navController.popBackStack() },
                onClearError = { uploadViewModel.clearError() }
            )

            // Navigate to field placement after successful upload
            if (uploadState.uploadSuccess && uploadState.uploadedDocumentId != null) {
                navController.navigate(Screen.FieldPlacement.createRoute(uploadState.uploadedDocumentId!!)) {
                    popUpTo(Screen.Upload.route) { inclusive = true }
                }
            }
        }

        // PDF Viewer Screen
        composable(
            route = Screen.PdfViewer.route,
            arguments = listOf(navArgument("documentId") { type = NavType.StringType })
        ) { backStackEntry ->
            val documentId = backStackEntry.arguments?.getString("documentId") ?: return@composable
            val viewerViewModel: PdfViewerViewModel = hiltViewModel()
            val viewerState by viewerViewModel.state.collectAsState()

            // Load document if not already loaded
            if (viewerState.documentId != documentId) {
                viewerViewModel.loadDocument(documentId)
            }

            PdfViewerScreen(
                state = viewerState,
                onBack = { navController.popBackStack() },
                onFieldClick = { field ->
                    if (field.fieldType.uppercase() == "SIGNATURE" && field.value == null) {
                        navController.navigate(Screen.SignatureCapture.createRoute(documentId, field.id))
                    }
                },
                onAddField = { _, _, _ -> },
                onPageChange = { page -> viewerViewModel.setCurrentPage(page) },
                isEditMode = false
            )
        }

        // Field Placement Screen
        composable(
            route = Screen.FieldPlacement.route,
            arguments = listOf(navArgument("documentId") { type = NavType.StringType })
        ) { backStackEntry ->
            val documentId = backStackEntry.arguments?.getString("documentId") ?: return@composable
            val fieldViewModel: FieldPlacementViewModel = hiltViewModel()
            val fieldState by fieldViewModel.state.collectAsState()

            // Load document if not already loaded
            if (fieldState.documentId != documentId) {
                fieldViewModel.loadDocument(documentId)
            }

            FieldPlacementScreen(
                fields = fieldState.fields,
                signers = fieldState.signers,
                currentPage = fieldState.currentPage,
                pageWidth = 595f,
                pageHeight = 842f,
                onAddField = { type, x, y, assignedToId ->
                    fieldViewModel.addField(type, x, y, assignedToId)
                },
                onUpdateField = { fieldId, x, y ->
                    fieldViewModel.updateFieldPosition(fieldId, x, y)
                },
                onRemoveField = { fieldId ->
                    fieldViewModel.removeField(fieldId)
                },
                onSave = { fieldViewModel.saveFields() },
                onBack = { navController.popBackStack() },
                isSaving = fieldState.isSaving
            )

            // Navigate back on successful save
            if (fieldState.saveSuccess) {
                navController.popBackStack()
            }
        }

        // Signature Capture Screen
        composable(
            route = Screen.SignatureCapture.route,
            arguments = listOf(
                navArgument("documentId") { type = NavType.StringType },
                navArgument("fieldId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val documentId = backStackEntry.arguments?.getString("documentId") ?: return@composable
            val fieldId = backStackEntry.arguments?.getString("fieldId") ?: return@composable
            val signatureViewModel: SignatureViewModel = hiltViewModel()
            val signatureState by signatureViewModel.state.collectAsState()

            SignatureCaptureScreen(
                fieldLabel = "Sign Document",
                onSignatureComplete = { signatureBase64 ->
                    signatureViewModel.submitSignature(signatureBase64)
                },
                onCancel = { navController.popBackStack() }
            )

            // Navigate back on successful signature submission
            if (signatureState.submitSuccess) {
                navController.popBackStack()
            }
        }
    }
}
