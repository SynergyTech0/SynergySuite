package com.synergysign.app.data.repository

import com.synergysign.app.presentation.affiliates.Payout
import com.synergysign.app.presentation.affiliates.Referral
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AffiliateRepository @Inject constructor() {
    
    suspend fun getAffiliateData(): AffiliateData {
        // In production, fetch from API
        return AffiliateData(
            referralCode = "ABC123XYZ",
            referralLink = "https://synergysign.app/ref/ABC123XYZ",
            totalEarnings = 245.50,
            pendingEarnings = 75.00,
            thisMonthEarnings = 45.00,
            totalReferrals = 12,
            payoutMethod = "paypal",
            payoutEmail = "user@example.com",
            referrals = emptyList(),
            payouts = emptyList()
        )
    }
    
    suspend fun requestPayout(method: String, email: String) {
        // In production, call API to request payout
    }
}

data class AffiliateData(
    val referralCode: String,
    val referralLink: String,
    val totalEarnings: Double,
    val pendingEarnings: Double,
    val thisMonthEarnings: Double,
    val totalReferrals: Int,
    val payoutMethod: String?,
    val payoutEmail: String?,
    val referrals: List<Referral>,
    val payouts: List<Payout>
)
