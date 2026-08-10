module shelby_clip::shelby_social {
    use std::string::String;
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_framework::event;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_std::table::{Self, Table};

    /// Error codes
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_INSUFFICIENT_FUNDS: u64 = 3;

    /// Social Signal Types
    const SIGNAL_LIKE: u8 = 1;
    const SIGNAL_COMMENT: u8 = 2;
    const SIGNAL_REPOST: u8 = 3;
    const SIGNAL_FOLLOW: u8 = 4;

    /// Store video access records
    struct VideoRegistry has key {
        // user_address -> video_id -> has_access
        access_map: Table<address, Table<String, bool>>,
        // video_id -> price
        prices: Table<String, u64>,
    }

    /// Store subscription records
    struct SubscriptionRegistry has key {
        // subscriber -> creator -> expiration_timestamp (seconds)
        subscriptions: Table<address, Table<address, u64>>,
        // creator -> monthly_price (octas)
        sub_prices: Table<address, u64>,
    }

    /// Store verified status for users
    struct VerifiedRegistry has key {
        // user_address -> is_verified
        verified_users: Table<address, bool>,
    }

    /// Store analytics data (view counts)
    struct AnalyticsRegistry has key {
        // video_id -> view_count
        view_counts: Table<String, u64>,
    }

    #[event]
    struct SocialEvent has drop, store {
        sender: address,
        target: address,
        signal_type: u8,
        metadata: String,
        timestamp: u64,
    }

    #[event]
    struct TipEvent has drop, store {
        sender: address,
        receiver: address,
        amount: u64,
        timestamp: u64,
    }

    #[event]
    struct PurchaseEvent has drop, store {
        buyer: address,
        creator: address,
        video_id: String,
        amount: u64,
        timestamp: u64,
    }

    #[event]
    struct SubscriptionEvent has drop, store {
        subscriber: address,
        creator: address,
        amount: u64,
        expiration: u64,
        timestamp: u64,
    }

    #[event]
    struct VerifiedEvent has drop, store {
        user: address,
        timestamp: u64,
    }

    /// Initialize the registries for the contract owner
    fun init_module(admin: &signer) {
        move_to(admin, VideoRegistry {
            access_map: table::new(),
            prices: table::new(),
        });
        move_to(admin, SubscriptionRegistry {
            subscriptions: table::new(),
            sub_prices: table::new(),
        });
        move_to(admin, VerifiedRegistry {
            verified_users: table::new(),
        });
        move_to(admin, AnalyticsRegistry {
            view_counts: table::new(),
        });
    }

    /// Emergency initialization for registries if module was already deployed
    public entry fun initialize_registries(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @shelby_clip, E_NOT_INITIALIZED);
        
        if (!exists<VideoRegistry>(admin_addr)) {
            move_to(admin, VideoRegistry { access_map: table::new(), prices: table::new() });
        };
        if (!exists<SubscriptionRegistry>(admin_addr)) {
            move_to(admin, SubscriptionRegistry { subscriptions: table::new(), sub_prices: table::new() });
        };
        if (!exists<VerifiedRegistry>(admin_addr)) {
            move_to(admin, VerifiedRegistry { verified_users: table::new() });
        };
        if (!exists<AnalyticsRegistry>(admin_addr)) {
            move_to(admin, AnalyticsRegistry { view_counts: table::new() });
        };
    }

    /// Backwards compatibility for old initialization function
    public entry fun initialize_subscription_registry(admin: &signer) {
        initialize_registries(admin);
    }

    /// User registers for verified status (One-time action)
    public entry fun verify_user(user: &signer) acquires VerifiedRegistry {
        let user_addr = signer::address_of(user);
        let reg = borrow_global_mut<VerifiedRegistry>(@shelby_clip);
        
        // Prevent multiple registrations
        assert!(!table::contains(&reg.verified_users, user_addr), 1001); // Error code for "Already Verified"
        
        table::add(&mut reg.verified_users, user_addr, true);

        event::emit(VerifiedEvent {
            user: user_addr,
            timestamp: timestamp::now_microseconds(),
        });
    }

    /// Tipping function - Direct monetization
    public entry fun tip_creator(
        sender: &signer,
        receiver: address,
        amount: u64
    ) {
        let sender_addr = signer::address_of(sender);
        coin::transfer<AptosCoin>(sender, receiver, amount);
        
        event::emit(TipEvent {
            sender: sender_addr,
            receiver: receiver,
            amount: amount,
            timestamp: timestamp::now_microseconds(),
        });
    }

    /// Pay-per-view: Purchase access to a specific video
    public entry fun purchase_video(
        buyer: &signer,
        creator: address,
        video_id: String,
        price: u64
    ) acquires VideoRegistry {
        let buyer_addr = signer::address_of(buyer);
        
        // Transfer payment
        coin::transfer<AptosCoin>(buyer, creator, price);
        
        let registry = borrow_global_mut<VideoRegistry>(@shelby_clip);
        
        if (!table::contains(&registry.access_map, buyer_addr)) {
            table::add(&mut registry.access_map, buyer_addr, table::new<String, bool>());
        };
        
        let user_access = table::borrow_mut(&mut registry.access_map, buyer_addr);
        if (!table::contains(user_access, video_id)) {
            table::add(user_access, video_id, true);
        };

        event::emit(PurchaseEvent {
            buyer: buyer_addr,
            creator: creator,
            video_id: video_id,
            amount: price,
            timestamp: timestamp::now_microseconds(),
        });
    }

    /// Subscription: Pay for 30 days of access to all of a creator's content
    public entry fun subscribe(
        subscriber: &signer,
        creator: address,
        amount: u64
    ) acquires SubscriptionRegistry {
        let sub_addr = signer::address_of(subscriber);
        
        // Transfer payment
        coin::transfer<AptosCoin>(subscriber, creator, amount);
        
        let reg = borrow_global_mut<SubscriptionRegistry>(@shelby_clip);
        
        if (!table::contains(&reg.subscriptions, sub_addr)) {
            table::add(&mut reg.subscriptions, sub_addr, table::new<address, u64>());
        };
        
        let user_subs = table::borrow_mut(&mut reg.subscriptions, sub_addr);
        let expiration = timestamp::now_seconds() + (30 * 24 * 60 * 60); // 30 days
        
        if (table::contains(user_subs, creator)) {
            *table::borrow_mut(user_subs, creator) = expiration;
        } else {
            table::add(user_subs, creator, expiration);
        };

        event::emit(SubscriptionEvent {
            subscriber: sub_addr,
            creator: creator,
            amount: amount,
            expiration: expiration,
            timestamp: timestamp::now_microseconds(),
        });
    }

    /// Emit a social signal on-chain
    public entry fun emit_social_signal(
        sender: &signer,
        target: address,
        signal_type: u8,
        metadata: String
    ) {
        let sender_addr = signer::address_of(sender);
        
        event::emit(SocialEvent {
            sender: sender_addr,
            target: target,
            signal_type: signal_type,
            metadata: metadata,
            timestamp: timestamp::now_microseconds(),
        });
    }

    /// Set or update the price for a video (creator only, enforced off-chain)
    public entry fun set_video_price(
        _creator: &signer,
        video_id: String,
        price: u64
    ) acquires VideoRegistry {
        let registry = borrow_global_mut<VideoRegistry>(@shelby_clip);
        if (table::contains(&registry.prices, video_id)) {
            *table::borrow_mut(&mut registry.prices, video_id) = price;
        } else {
            table::add(&mut registry.prices, video_id, price);
        };
    }

    /// Set or update the monthly subscription price (creator only)
    public entry fun set_subscription_price(
        creator: &signer,
        price: u64
    ) acquires SubscriptionRegistry {
        let creator_addr = signer::address_of(creator);
        let reg = borrow_global_mut<SubscriptionRegistry>(@shelby_clip);
        if (table::contains(&reg.sub_prices, creator_addr)) {
            *table::borrow_mut(&mut reg.sub_prices, creator_addr) = price;
        } else {
            table::add(&mut reg.sub_prices, creator_addr, price);
        };
    }

    /// Check if a buyer has access to a specific video (original version for compatibility)
    #[view]
    public fun has_video_access(buyer: address, video_id: String): bool acquires VideoRegistry {
        if (!exists<VideoRegistry>(@shelby_clip)) return false;
        let registry = borrow_global<VideoRegistry>(@shelby_clip);
        if (!table::contains(&registry.access_map, buyer)) return false;
        let user_access = table::borrow(&registry.access_map, buyer);
        table::contains(user_access, video_id)
    }

    /// Check if a buyer has access to a specific video (New version: direct purchase OR active subscription)
    #[view]
    public fun has_video_access_v2(buyer: address, creator: address, video_id: String): bool acquires VideoRegistry, SubscriptionRegistry {
        // 1. Check direct purchase
        if (has_video_access(buyer, video_id)) return true;

        // 2. Check active subscription to creator
        is_subscribed(buyer, creator)
    }

    /// Check if a user is actively subscribed to a creator
    #[view]
    public fun is_subscribed(subscriber: address, creator: address): bool acquires SubscriptionRegistry {
        if (!exists<SubscriptionRegistry>(@shelby_clip)) return false;
        let reg = borrow_global<SubscriptionRegistry>(@shelby_clip);
        if (!table::contains(&reg.subscriptions, subscriber)) return false;
        
        let user_subs = table::borrow(&reg.subscriptions, subscriber);
        if (!table::contains(user_subs, creator)) return false;
        
        let expiration = *table::borrow(user_subs, creator);
        expiration > timestamp::now_seconds()
    }

    /// Check if a user is verified on-chain
    #[view]
    public fun is_user_verified(user: address): bool acquires VerifiedRegistry {
        if (!exists<VerifiedRegistry>(@shelby_clip)) return false;
        let reg = borrow_global<VerifiedRegistry>(@shelby_clip);
        table::contains(&reg.verified_users, user)
    }

    /// Get the price set for a video (returns 0 if no price set)
    #[view]
    public fun get_video_price(video_id: String): u64 acquires VideoRegistry {
        if (!exists<VideoRegistry>(@shelby_clip)) return 0;
        let registry = borrow_global<VideoRegistry>(@shelby_clip);
        if (!table::contains(&registry.prices, video_id)) return 0;
        *table::borrow(&registry.prices, video_id)
    }

    /// Get the monthly subscription price for a creator
    #[view]
    public fun get_subscription_price(creator: address): u64 acquires SubscriptionRegistry {
        if (!exists<SubscriptionRegistry>(@shelby_clip)) return 0;
        let reg = borrow_global<SubscriptionRegistry>(@shelby_clip);
        if (!table::contains(&reg.sub_prices, creator)) return 0;
        *table::borrow(&reg.sub_prices, creator)
    }

    /// Record a video view on-chain
    public entry fun record_view(
        _user: &signer,
        video_id: String
    ) acquires AnalyticsRegistry {
        let reg = borrow_global_mut<AnalyticsRegistry>(@shelby_clip);
        if (table::contains(&reg.view_counts, video_id)) {
            let count = table::borrow_mut(&mut reg.view_counts, video_id);
            *count = *count + 1;
        } else {
            table::add(&mut reg.view_counts, video_id, 1);
        };
    }

    /// Get the current view count for a video
    #[view]
    public fun get_view_count(video_id: String): u64 acquires AnalyticsRegistry {
        if (!exists<AnalyticsRegistry>(@shelby_clip)) return 0;
        let reg = borrow_global<AnalyticsRegistry>(@shelby_clip);
        if (!table::contains(&reg.view_counts, video_id)) return 0;
        *table::borrow(&reg.view_counts, video_id)
    }
}
