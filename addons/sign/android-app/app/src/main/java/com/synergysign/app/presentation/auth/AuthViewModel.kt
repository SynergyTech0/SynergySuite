package com.synergysign.app.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.model.User
import com.synergysign.app.data.repository.AuthRepository
import com.synergysign.app.data.repository.TokenRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthState(
    val isLoading: Boolean = false,
    val isAuthenticated: Boolean = false,
    val user: User? = null,
    val error: String? = null
)

sealed class AuthEvent {
    object CheckAuth : AuthEvent()
    data class Login(val email: String, val password: String) : AuthEvent()
    data class Signup(
        val email: String,
        val password: String,
        val firstName: String,
        val lastName: String,
        val companyName: String? = null
    ) : AuthEvent()
    data class VerifyEmail(val code: String) : AuthEvent()
    object Logout : AuthEvent()
    object ClearError : AuthEvent()
}

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val tokenRepository: TokenRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        checkAuthStatus()
    }

    fun onEvent(event: AuthEvent) {
        when (event) {
            is AuthEvent.CheckAuth -> checkAuthStatus()
            is AuthEvent.Login -> login(event.email, event.password)
            is AuthEvent.Signup -> signup(
                event.email,
                event.password,
                event.firstName,
                event.lastName,
                event.companyName
            )
            is AuthEvent.VerifyEmail -> verifyEmail(event.code)
            is AuthEvent.Logout -> logout()
            is AuthEvent.ClearError -> clearError()
        }
    }

    private fun checkAuthStatus() {
        viewModelScope.launch {
            val isAuthenticated = authRepository.isAuthenticated()
            _state.value = _state.value.copy(isAuthenticated = isAuthenticated)
        }
    }

    private fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            
            authRepository.login(email, password)
                .onSuccess { user ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        user = user,
                        error = null
                    )
                }
                .onFailure { exception ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = exception.message ?: "Login failed"
                    )
                }
        }
    }

    private fun signup(
        email: String,
        password: String,
        firstName: String,
        lastName: String,
        companyName: String?
    ) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            
            authRepository.signup(email, password, firstName, lastName, companyName)
                .onSuccess { user ->
                    // Note: Email verification may be required before login
                    // The server will send a verification email automatically
                    // For now, attempt auto-login - server will enforce verification if needed
                    login(email, password)
                }
                .onFailure { exception ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = exception.message ?: "Signup failed"
                    )
                }
        }
    }

    private fun verifyEmail(code: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            
            authRepository.verifyEmail(code)
                .onSuccess {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = null
                    )
                }
                .onFailure { exception ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = exception.message ?: "Verification failed"
                    )
                }
        }
    }

    private fun logout() {
        viewModelScope.launch {
            authRepository.logout()
            _state.value = AuthState(isAuthenticated = false)
        }
    }

    private fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
