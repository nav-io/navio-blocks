interface LoaderProps {
  text?: string;
}

export default function Loader({ text = 'Loading...' }: LoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-10 h-10 border-2 border-neon-purple/30 border-t-neon-purple rounded-full animate-spin mb-4" />
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  );
}
