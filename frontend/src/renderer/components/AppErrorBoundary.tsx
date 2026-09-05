import React from "react";

type Props = {
	children: React.ReactNode;
};

type BoundaryProps = Props & {
	fallbackBody: string;
	fallbackTitle: string;
};

type State = {
	hasError: boolean;
};

class AppErrorBoundaryClass extends React.Component<BoundaryProps, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(_error: Error, _info: React.ErrorInfo) {
		// Rendering failed; the fallback UI below is the product response.
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-screen items-center justify-center bg-background px-6 text-center text-foreground">
					<div>
						<h1 className="text-heading-sm font-semibold">{this.props.fallbackTitle}</h1>
						<p className="mt-2 text-sm text-muted-foreground">{this.props.fallbackBody}</p>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}

export function AppErrorBoundary({ children }: Props) {
	return (
		<AppErrorBoundaryClass fallbackBody={"Restart the app or check the daemon logs if this keeps happening."} fallbackTitle={"The app hit an unexpected error."}>
			{children}
		</AppErrorBoundaryClass>
	);
}
