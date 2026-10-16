package com.synergysign.app.data.repository

import com.synergysign.app.presentation.billing.*
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class BillingRepository @Inject constructor() {
    
    suspend fun getCurrentSubscription(): SubscriptionInfo {
        // In production, fetch from Stripe API
        return SubscriptionInfo(
            tier = "PRO",
            status = "Active",
            currentPeriodEnd = Calendar.getInstance().apply { add(Calendar.MONTH, 1) }.time,
            cancelAtPeriodEnd = false
        )
    }
    
    suspend fun getAvailablePlans(): List<PricingPlan> {
        return listOf(
            PricingPlan(
                id = "free",
                name = "Free",
                tier = "FREE",
                price = 0,
                features = listOf(
                    PlanFeature("3 documents/month", true),
                    PlanFeature("Basic templates", true),
                    PlanFeature("Email support", true),
                    PlanFeature("AI features", false),
                    PlanFeature("Custom branding", false)
                )
            ),
            PricingPlan(
                id = "basic",
                name = "Basic",
                tier = "BASIC",
                price = 15,
                features = listOf(
                    PlanFeature("25 documents/month", true),
                    PlanFeature("All templates", true),
                    PlanFeature("Priority support", true),
                    PlanFeature("AI features", false),
                    PlanFeature("Custom branding", false)
                )
            ),
            PricingPlan(
                id = "pro",
                name = "Pro",
                tier = "PRO",
                price = 45,
                isPopular = true,
                features = listOf(
                    PlanFeature("Unlimited documents", true),
                    PlanFeature("All templates", true),
                    PlanFeature("Priority support", true),
                    PlanFeature("AI features", true),
                    PlanFeature("Custom branding", false)
                )
            ),
            PricingPlan(
                id = "enterprise",
                name = "Enterprise",
                tier = "ENTERPRISE",
                price = 199,
                features = listOf(
                    PlanFeature("Unlimited documents", true),
                    PlanFeature("All templates", true),
                    PlanFeature("Dedicated support", true),
                    PlanFeature("AI features", true),
                    PlanFeature("Custom branding", true)
                )
            )
        )
    }
    
    suspend fun getPaymentMethod(): PaymentMethod? {
        // In production, fetch from Stripe
        return PaymentMethod(
            brand = "Visa",
            last4 = "4242",
            expMonth = 12,
            expYear = 2025
        )
    }
    
    suspend fun getInvoices(): List<Invoice> {
        // In production, fetch from Stripe
        val calendar = Calendar.getInstance()
        return listOf(
            Invoice("inv_1", "Pro Plan - December 2024", 45.0, calendar.time, true),
            Invoice("inv_2", "Pro Plan - November 2024", 45.0, calendar.apply { add(Calendar.MONTH, -1) }.time, true),
            Invoice("inv_3", "Pro Plan - October 2024", 45.0, calendar.apply { add(Calendar.MONTH, -1) }.time, true)
        )
    }
    
    suspend fun changePlan(tier: String) {
        // In production, call Stripe to change subscription
    }
    
    suspend fun getPaymentMethodUpdateUrl(): String {
        // In production, create Stripe checkout session
        return "https://billing.stripe.com/update"
    }
    
    suspend fun getCustomerPortalUrl(): String {
        // In production, create Stripe customer portal session
        return "https://billing.stripe.com/portal"
    }
}
