package com.youpi.observer

import java.util.regex.Pattern

data class ParsedNotification(
    val amountPaise: Long,
    val amountRupees: String,
    val bankReferenceNumber: String?,
    val senderVpa: String?,
    val rawTitle: String,
    val rawText: String,
    val packageName: String,
    val timestamp: Long
)

object NotificationParser {
    // Regex matching Indian Rupee amounts (e.g. Rs 200, Rs. 200.00, INR 500, ₹1,200.50)
    private val AMOUNT_PATTERN = Pattern.compile(
        """(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)""",
        Pattern.CASE_INSENSITIVE
    )

    // Regex matching bank UTR / Reference numbers
    private val REF_PATTERN = Pattern.compile(
        """(?:utr|ref(?:\s*no)?|txn(?:\s*id)?|rrn)[:\s#]+([a-zA-Z0-9\-_]{6,35})""",
        Pattern.CASE_INSENSITIVE
    )

    // Regex matching sender VPA
    private val VPA_PATTERN = Pattern.compile(
        """(?:from|by)\s+([a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,64})""",
        Pattern.CASE_INSENSITIVE
    )

    // Common Indian UPI and Banking App package prefixes
    private val BANKING_PACKAGES = setOf(
        "com.phonepe.app",
        "com.google.android.apps.nbu.paisa.user",
        "net.one97.paytm",
        "in.org.npci.upiapp",
        "com.snapwork.hdfc",
        "com.csam.icici.bank.imobile",
        "com.sbi.upi",
        "com.axis.mobile",
        "com.msf.kbank.mobile"
    )

    fun isRelevantPackage(pkg: String): Boolean {
        if (BANKING_PACKAGES.contains(pkg)) return true
        val lower = pkg.toLowerCase()
        return lower.contains("upi") || lower.contains("bank") || lower.contains("pay")
    }

    fun parse(
        packageName: String,
        title: String?,
        text: String?,
        postTime: Long
    ): ParsedNotification? {
        val safeTitle = title ?: ""
        val safeText = text ?: ""
        val combined = "$safeTitle $safeText"

        // Check for credit keywords
        val creditMatch = Regex("""(credited|received|deposit|payment received|upi/cr)""", RegexOption.IGNORE_CASE)
        if (!creditMatch.containsMatchIn(combined)) {
            return null // Skip debits or irrelevant alerts
        }

        // Extract Amount
        val amtMatcher = AMOUNT_PATTERN.matcher(combined)
        if (!amtMatcher.find()) {
            return null
        }

        val rawAmountStr = amtMatcher.group(1)?.replace(",", "") ?: return null
        val paise = try {
            val parts = rawAmountStr.split(".")
            val whole = parts[0].toLong()
            val fraction = if (parts.size > 1) parts[1].padEnd(2, '0').take(2).toLong() else 0L
            (whole * 100L) + fraction
        } catch (e: Exception) {
            return null
        }

        if (paise <= 0L) return null

        // Extract Reference / UTR
        var bankRef: String? = null
        val refMatcher = REF_PATTERN.matcher(combined)
        if (refMatcher.find()) {
            bankRef = refMatcher.group(1)?.trim()
        }

        // Extract Sender VPA
        var senderVpa: String? = null
        val vpaMatcher = VPA_PATTERN.matcher(combined)
        if (vpaMatcher.find()) {
            senderVpa = vpaMatcher.group(1)?.trim()?.trimEnd('.', ',', ';')
        }

        return ParsedNotification(
            amountPaise = paise,
            amountRupees = rawAmountStr,
            bankReferenceNumber = bankRef,
            senderVpa = senderVpa,
            rawTitle = safeTitle,
            rawText = safeText,
            packageName = packageName,
            timestamp = postTime
        )
    }
}
