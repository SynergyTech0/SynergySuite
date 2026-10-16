package com.synergysign.app.presentation.billing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.synergysign.app.data.repository.BillingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.*
import javax.inject.Inject

@HiltViewModel
class BillingViewModel @Inject constructor(
    private val billingRepository: BillingRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow(BillingUiState())
    val uiState: StateFlow<BillingUiState> = _uiState.asStateFlow()
    
    init {
        loadBillingInfo()
    }
    
    private fun loadBillingInfo() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val subscription = billingRepository.getCurrentSubscription()
                val plans = billingRepository.getAvailablePlans()
                val paymentMethod = billingRepository.getPaymentMethod()
                val invoices = billingRepository.getInvoices()
                
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        subscription = subscription,
                        plans = plans,
                        paymentMethod = paymentMethod,
                        invoices = invoices
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }
    
    fun selectPlan(plan: PricingPlan) {
        viewModelScope.launch {
            _uiState.update { it.copy(isProcessing = true) }
            try {
                billingRepository.changePlan(plan.tier)
                loadBillingInfo()
            } catch (e: Exception) {
                _uiState.update { it.copy(isProcessing = false, error = e.message) }
            }
        }
    }
    
    fun updatePaymentMethod() {
        viewModelScope.launch {
            try {
                val url = billingRepository.getPaymentMethodUpdateUrl()
                _uiState.update { it.copy(openUrl = url) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun openCustomerPortal() {
        viewModelScope.launch {
            try {
                val url = billingRepository.getCustomerPortalUrl()
                _uiState.update { it.copy(openUrl = url) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }
    
    fun viewAllInvoices() {
        _uiState.update { it.copy(showAllInvoices = true) }
    }
    
    fun downloadInvoice(invoice: Invoice) {
        invoice.pdfUrl?.let { url ->
            _uiState.update { it.copy(openUrl = url) }
        }
    }
    
    fun clearOpenUrl() {
        _uiState.update { it.copy(openUrl = null) }
    }
}

data class BillingUiState(
    val isLoading: Boolean = true,
    val isProcessing: Boolean = false,
    val error: String? = null,
    val subscription: SubscriptionInfo = SubscriptionInfo(),
    val plans: List<PricingPlan> = emptyList(),
    val paymentMethod: PaymentMethod? = null,
    val invoices: List<Invoice> = emptyList(),
    val showAllInvoices: Boolean = false,
    val openUrl: String? = null
)
