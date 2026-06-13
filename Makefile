deploy-konva:
	kubectl apply -k k8s/overlays/konva/

deploy-leafer:
	kubectl apply -k k8s/overlays/leafer/

deploy-all:
	kubectl apply -k k8s/

undeploy-all:
	kubectl delete -k k8s/

logs-konva:
	kubectl logs -l app=image-render-server -l app.kubernetes.io/name=konva-image-render-server --tail=50 -f

port-konva:
	kubectl port-forward svc/konva-image-render-server 3004:3000
