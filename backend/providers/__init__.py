"""Raidex provider abstraction layer.

Every external integration goes behind an interface in this package.
Swapping from a stub to a real provider (Razorpay, Karza, OneSignal, …) is
a single-file change — routers and services never import provider modules
directly; they import the factories exposed here.
"""

from .payment_gateway import PaymentGateway, get_payment_gateway
from .kyc_provider import KYCProvider, get_kyc_provider
from .damage_inspector import DamageInspector, get_damage_inspector
from .push_sender import PushSender, get_push_sender
from .ai_provider import AIProvider, get_ai_provider
from .gps_provider import GPSProvider, get_gps_provider

__all__ = [
    "PaymentGateway",
    "get_payment_gateway",
    "KYCProvider",
    "get_kyc_provider",
    "DamageInspector",
    "get_damage_inspector",
    "PushSender",
    "get_push_sender",
    "AIProvider",
    "get_ai_provider",
    "GPSProvider",
    "get_gps_provider",
]
