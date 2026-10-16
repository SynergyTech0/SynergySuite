package com.synergysign.app.presentation.affiliates

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.AffiliateRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AffiliatesViewModel @Inject constructor(
    private val affiliateRepository: AffiliateRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(AffiliatesUiState())
    val uiState: StateFlow<AffiliatesUiState> = _uiState.asStateFlow()
    
    init {
        loadAffiliateData()
    }
    
    private fun loadAffiliateData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val data = affiliateRepository.getAffiliateData()
                
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        referralCode = data.referralCode,
                        referralLink = data.referralLink,
                        totalEarnings = data.totalEarnings,
                        pendingEarnings = data.pendingEarnings,
                        thisMonthEarnings = data.thisMonthEarnings,
                        totalReferrals = data.totalReferrals,
                        payoutMethod = data.payoutMethod,
                        payoutEmail = data.payoutEmail,
                        referrals = data.referrals,
                        payouts = data.payouts
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }
    
    fun shareLink() {
        _uiState.update { it.copy(shareIntent = "link") }
    }
    
    fun shareQrCode() {
        _uiState.update { it.copy(shareIntent = "qr") }
    }
    
    fun requestPayout(method: String, email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isProcessing = true) }
            try {
                affiliateRepository.requestPayout(method, email)
                loadAffiliateData()
            } catch (e: Exception) {
                _uiState.update { it.copy(isProcessing = false, error = e.message) }
            }
        }
    }
    
    fun clearShareIntent() {
        _uiState.update { it.copy(shareIntent = null) }
    }
}

data class AffiliatesUiState(
    val isLoading: Boolean = true,
    val isProcessing: Boolean = false,
    val error: String? = null,
    val referralCode: String = "",
    val referralLink: String = "",
    val totalEarnings: Double = 0.0,
    val pendingEarnings: Double = 0.0,
    val thisMonthEarnings: Double = 0.0,
    val totalReferrals: Int = 0,
    val payoutMethod: String? = null,
    val payoutEmail: String? = null,
    val referrals: List<Referral> = emptyList(),
    val payouts: List<Payout> = emptyList(),
    val shareIntent: String? = null
)
