'use client';

import { useState, useRef } from 'react';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import { CreditCard, Banknote, MapPin, Send } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';

const libraries: ('places')[] = ['places'];

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function OrderCreationForm({ storeId }: { storeId: string }) {
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [comments, setComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: 'script-loader',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
    libraries,
  });

  const handlePlaceChanged = () => {
    if (autocompleteRef.current !== null) {
      const place = autocompleteRef.current.getPlace();
      setStreet(place.name || place.formatted_address || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!street) return alert('Please enter a street address.');

    setIsSubmitting(true);
    const fullAddress = `${street} ${streetNumber}`.trim();

    const { error } = await supabase.from('orders').insert({
      store_id: storeId,
      address: fullAddress,
      payment_method: paymentMethod,
      comments: comments,
      status: 'pending',
    });

    setIsSubmitting(false);

    if (error) {
      console.error(error);
      alert('Failed to create order. Please try again.');
    } else {
      // Reset form on success
      setStreet('');
      setStreetNumber('');
      setComments('');
      setPaymentMethod('cash');
    }
  };

  if (!isLoaded) return <div className="animate-pulse h-64 bg-gray-200 dark:bg-[#1A1A1A] rounded-xl"></div>;

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-[#1A1A1A] p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900 dark:text-white">
        <MapPin className="text-[#C5A066] w-5 h-5" />
        New Order
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Address Autocomplete */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Street</label>
          <Autocomplete
            onLoad={(autocomplete) => (autocompleteRef.current = autocomplete)}
            onPlaceChanged={handlePlaceChanged}
          >
            <input
              type="text"
              placeholder="Start typing street name..."
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#C5A066] dark:text-white transition-all"
            />
          </Autocomplete>
        </div>

        {/* Street Number */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Number</label>
          <input
            type="text"
            placeholder="e.g. 12A"
            value={streetNumber}
            onChange={(e) => setStreetNumber(e.target.value)}
            className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#C5A066] dark:text-white transition-all"
          />
        </div>
      </div>

      {/* Payment Method Toggle */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment Method</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#121212]">
          <button
            type="button"
            onClick={() => setPaymentMethod('cash')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              paymentMethod === 'cash'
                ? 'bg-[#C5A066] text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <Banknote className="w-4 h-4" />
            💵 ΜΕΤΡΗΤΑ
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod('card')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              paymentMethod === 'card'
                ? 'bg-[#C5A066] text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            💳 ΚΑΡΤΑ
          </button>
        </div>
      </div>

      {/* Comments */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comments (Optional)</label>
        <textarea
          rows={2}
          placeholder="Ring the bell, 2nd floor, etc..."
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#C5A066] dark:text-white transition-all resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full flex items-center justify-center gap-2 bg-[#C5A066] hover:bg-[#b08d55] text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
      >
        <Send className="w-5 h-5" />
        {isSubmitting ? 'Submitting...' : 'Dispatch Order'}
      </button>
    </form>
  );
}